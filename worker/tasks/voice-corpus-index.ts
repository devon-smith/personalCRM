/**
 * Voice corpus indexing (M6.1).
 *
 * Walks Jennifer's sent mail in Gmail, fetches bodies for OUTBOUND
 * EmailMessage rows that don't yet have a `fullBody`, extracts voice
 * features, classifies the recipient's relationship type, embeds the
 * cleaned body via Voyage, and writes a VoiceExample row.
 *
 * After each pass it re-aggregates the per-user `VoiceProfile.learned`
 * snapshot so the /settings/voice page can render immediately on next
 * load.
 *
 * Idempotent: only processes EmailMessage rows that are OUTBOUND, not
 * automated, have no existing VoiceExample, and have a fullBody (or
 * can fetch one). Safe to re-run.
 *
 * Triggered manually via `POST /api/voice/reindex` and (later) on a
 * weekly cron via worker/index.ts.
 */
import type { Task } from "graphile-worker";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { extractFeatures } from "../../src/lib/voice/feature-extraction";
import {
  classifyRecipient,
  clearRelationshipClassifierCache,
} from "../../src/lib/voice/relationship-classifier";
import { fetchMessageBodiesBatch } from "../../src/lib/gmail/fetch-body";
import {
  embedBatch,
  formatVectorLiteral,
  MAX_BATCH_SIZE,
  VoyageError,
} from "../../src/lib/search/embeddings";
import { aggregateVoiceProfile } from "../../src/lib/voice/profile";

/** Per-run cap so a single execution doesn't burn the full Gmail quota. */
const EMAILS_PER_RUN = 200;

interface VoiceCorpusPayload {
  userId?: string;
  /** Force re-extract even for emails that already have a VoiceExample. */
  rebuild?: boolean;
}

const voiceCorpusIndex: Task = async (rawPayload, helpers) => {
  const payload = (rawPayload ?? {}) as VoiceCorpusPayload;
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    const userIds = payload.userId
      ? [payload.userId]
      : (await prisma.user.findMany({ select: { id: true } })).map((u) => u.id);

    for (const userId of userIds) {
      clearRelationshipClassifierCache();
      const summary = await indexForUser(prisma, userId, helpers, payload.rebuild ?? false);
      helpers.logger.info(
        `voice-corpus: user=${userId} fetched=${summary.bodiesFetched} ` +
          `indexed=${summary.examplesWritten} skipped=${summary.skipped} ` +
          `embedFailed=${summary.embedFailures}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
};

interface RunSummary {
  bodiesFetched: number;
  examplesWritten: number;
  skipped: number;
  embedFailures: number;
}

async function indexForUser(
  prisma: PrismaClient,
  userId: string,
  helpers: { logger: { info: (msg: string) => void; debug: (msg: string) => void } },
  rebuild: boolean,
): Promise<RunSummary> {
  const summary: RunSummary = {
    bodiesFetched: 0,
    examplesWritten: 0,
    skipped: 0,
    embedFailures: 0,
  };

  // Candidate set: OUTBOUND emails that aren't automated, and that
  // either lack a VoiceExample (the normal case) or are being rebuilt.
  const candidates = await prisma.emailMessage.findMany({
    where: {
      userId,
      direction: "OUTBOUND",
      isAutomated: false,
      ...(rebuild ? {} : { voiceExample: null }),
    },
    orderBy: { occurredAt: "desc" },
    take: EMAILS_PER_RUN,
    select: {
      id: true,
      gmailId: true,
      toEmail: true,
      occurredAt: true,
      fullBody: true,
    },
  });

  if (candidates.length === 0) {
    helpers.logger.debug(`voice-corpus: nothing to index for ${userId}`);
    return summary;
  }

  // Step 1: backfill missing bodies in one batched Gmail pass.
  const needingBody = candidates.filter((c) => !c.fullBody).map((c) => c.gmailId);
  let fetched = new Map<string, { body: string }>();
  if (needingBody.length > 0) {
    fetched = await fetchMessageBodiesBatch(userId, needingBody);
    summary.bodiesFetched = fetched.size;
    // Persist bodies — even if a row later fails embedding, we don't
    // want to re-fetch on the next run.
    for (const [gmailId, { body }] of fetched) {
      const target = candidates.find((c) => c.gmailId === gmailId);
      if (!target) continue;
      await prisma.emailMessage.update({
        where: { id: target.id },
        data: { fullBody: body },
      });
    }
  }

  // Step 2: per-email: extract features, classify recipient.
  interface PreparedExample {
    emailMessageId: string;
    gmailId: string;
    toEmail: string;
    sentAt: Date;
    body: string;
    cleanedBody: string;
    opening: string;
    closing: string;
    wordCount: number;
    avgSentenceLen: number;
    candidateNgrams: string[];
    relationshipType: string;
  }

  const prepared: PreparedExample[] = [];
  for (const c of candidates) {
    const body = c.fullBody ?? fetched.get(c.gmailId)?.body ?? null;
    if (!body) {
      summary.skipped++;
      continue;
    }
    const features = extractFeatures(body);
    // Skip empty / boilerplate-only emails — no useful voice signal.
    if (features.wordCount < 5) {
      summary.skipped++;
      continue;
    }
    const relationshipType = await classifyRecipient({
      prisma,
      userId,
      recipientEmail: c.toEmail,
    });
    prepared.push({
      emailMessageId: c.id,
      gmailId: c.gmailId,
      toEmail: c.toEmail,
      sentAt: c.occurredAt,
      body,
      cleanedBody: features.cleanedBody,
      opening: features.opening,
      closing: features.closing,
      wordCount: features.wordCount,
      avgSentenceLen: features.avgSentenceLen,
      candidateNgrams: features.candidateNgrams,
      relationshipType,
    });
  }

  // Step 3: embed cleaned bodies via Voyage (batched, optional).
  const embeddings = new Map<string, number[]>(); // emailMessageId → vector
  if (process.env.VOYAGE_API_KEY && prepared.length > 0) {
    for (let i = 0; i < prepared.length; i += MAX_BATCH_SIZE) {
      const slice = prepared.slice(i, i + MAX_BATCH_SIZE);
      try {
        const { embeddings: vecs } = await embedBatch(
          slice.map((p) => truncateForEmbedding(p.cleanedBody)),
          "document",
        );
        slice.forEach((p, j) => embeddings.set(p.emailMessageId, vecs[j]));
      } catch (err) {
        summary.embedFailures += slice.length;
        if (err instanceof VoyageError && !err.retryable) {
          helpers.logger.info(`voice-corpus: voyage terminal error: ${err.message}`);
          break;
        }
      }
    }
  }

  // Step 4: write VoiceExample rows. Upsert in case of rebuild.
  for (const p of prepared) {
    const embedding = embeddings.get(p.emailMessageId);
    const baseData = {
      userId,
      gmailId: p.gmailId,
      relationshipType: p.relationshipType,
      openingType: p.opening,
      closingType: p.closing,
      wordCount: p.wordCount,
      avgSentenceLen: p.avgSentenceLen,
      signaturePhrases: p.candidateNgrams,
      sentAt: p.sentAt,
      indexedAt: new Date(),
    };
    await prisma.voiceExample.upsert({
      where: { emailMessageId: p.emailMessageId },
      create: { emailMessageId: p.emailMessageId, ...baseData },
      update: baseData,
    });
    // Write embedding via raw SQL since Prisma doesn't bind vector.
    if (embedding) {
      await prisma.$executeRaw`
        UPDATE "VoiceExample"
        SET embedding = ${formatVectorLiteral(embedding)}::vector
        WHERE "emailMessageId" = ${p.emailMessageId}
      `;
    }
    summary.examplesWritten++;
  }

  // Step 5: re-aggregate the profile snapshot for fast page renders.
  await aggregateVoiceProfile(prisma, userId);

  return summary;
}

/**
 * Voyage's voyage-3-lite caps at 32k tokens per text. Our cleaned
 * bodies are typically <2000 chars (~400 tokens). Truncate defensively
 * at 8000 chars to keep us well under the limit on the rare long-form
 * essay; the head of the email carries the voice signal anyway.
 */
function truncateForEmbedding(text: string): string {
  if (text.length <= 8000) return text;
  return text.slice(0, 8000);
}

export default voiceCorpusIndex;
