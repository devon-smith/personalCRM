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
import type { PrismaClient } from "../../src/generated/prisma/client";
import { createWorkerPrismaClient } from "../db.js";
import { extractFeatures } from "../../src/lib/voice/feature-extraction";
import { detectSignatureLines } from "../../src/lib/voice/signature-detector";
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
  const prisma = createWorkerPrismaClient();

  try {
    const userIds = payload.userId
      ? [payload.userId]
      : (await prisma.user.findMany({ select: { id: true } })).map((u) => u.id);

    for (const userId of userIds) {
      clearRelationshipClassifierCache();
      const summary = await indexForUser(prisma, userId, helpers, payload.rebuild ?? false);
      helpers.logger.info(
        `voice-corpus: user=${userId} sigLines=${summary.signatureLinesDetected} ` +
          `fetched=${summary.bodiesFetched} indexed=${summary.examplesWritten} ` +
          `skipped=${summary.skipped} embedFailed=${summary.embedFailures}`,
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
  signatureLinesDetected: number;
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
    signatureLinesDetected: 0,
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
    const result = await fetchMessageBodiesBatch(userId, needingBody);
    fetched = result.bodies;
    summary.bodiesFetched = result.bodies.size;

    if (result.errors.size > 0 || result.notFound > 0 || result.noBody > 0) {
      helpers.logger.info(
        `voice-corpus: fetch-body breakdown — ok=${result.bodies.size} ` +
          `notFound=${result.notFound} noBody=${result.noBody} errors=${result.errors.size}`,
      );
      const categories = new Map<string, { count: number; sampleId: string }>();
      for (const [gmailId, msg] of result.errors) {
        const key = categorizeError(msg);
        const prev = categories.get(key);
        if (prev) prev.count++;
        else categories.set(key, { count: 1, sampleId: gmailId });
      }
      const sorted = [...categories.entries()].sort((a, b) => b[1].count - a[1].count);
      for (const [cat, { count, sampleId }] of sorted.slice(0, 5)) {
        const exampleMsg = result.errors.get(sampleId) ?? "";
        helpers.logger.info(
          `voice-corpus:   [${count}x] ${cat} (e.g. id=${sampleId}: ${exampleMsg.slice(0, 180)})`,
        );
      }
    }

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

  // Step 1.5: detect per-user signature lines from the corpus (M6.1.1).
  // Pull a wider sample than this batch — fullBody-populated rows from
  // previous runs improve detection accuracy. Bounded to 1000 to keep
  // memory reasonable; signature patterns stabilize well before that.
  const signatureLines = await detectUserSignatureLines(prisma, userId);
  summary.signatureLinesDetected = signatureLines.length;
  await prisma.voiceProfile.upsert({
    where: { userId },
    create: {
      userId,
      learned: {},
      overrides: { removedPhrases: [], assertions: {} },
      signatureLines,
    },
    update: { signatureLines },
  });

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
    const features = extractFeatures(body, signatureLines);
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
  //
  // Batch size capped at 32 (not Voyage's 128 max). A 128-batch of
  // ~400-token emails is ~50k tokens — Voyage's free-tier per-request
  // limit chokes on that and returns 429 retryable, which the old
  // catch silently swallowed (`!err.retryable` skipped logging). We
  // surface both retryable and terminal errors now, sleep on the
  // first retryable, and retry the failed batch once before counting
  // it as a real failure.
  const EMBED_BATCH_SIZE = Math.min(32, MAX_BATCH_SIZE);
  const RETRY_DELAY_MS = 8000;
  const embeddings = new Map<string, number[]>(); // emailMessageId → vector
  if (process.env.VOYAGE_API_KEY && prepared.length > 0) {
    for (let i = 0; i < prepared.length; i += EMBED_BATCH_SIZE) {
      const slice = prepared.slice(i, i + EMBED_BATCH_SIZE);
      const texts = slice.map((p) => truncateForEmbedding(p.cleanedBody));
      let succeeded = false;
      for (let attempt = 0; attempt < 2 && !succeeded; attempt++) {
        try {
          const { embeddings: vecs } = await embedBatch(texts, "document", {
            userId,
            feature: "voice_corpus_email_index",
            metadata: {
              batchStart: i,
              batchSize: slice.length,
              attempt: attempt + 1,
              rebuild,
            },
          });
          slice.forEach((p, j) => embeddings.set(p.emailMessageId, vecs[j]));
          succeeded = true;
        } catch (err) {
          const isVoyageErr = err instanceof VoyageError;
          const retryable = isVoyageErr ? err.retryable : false;
          const msg = err instanceof Error ? err.message : String(err);
          helpers.logger.info(
            `voice-corpus: voyage ${retryable ? "retryable" : "terminal"} ` +
              `error on batch ${i}-${i + slice.length} attempt ${attempt + 1}: ${msg}`,
          );
          if (!retryable) break;
          // Pause before retry — gives the per-minute token window a
          // chance to reset before the next attempt.
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
      if (!succeeded) summary.embedFailures += slice.length;
      // Small pacing delay between successful batches to stay under
      // the per-minute token cap even when nothing has failed.
      if (succeeded && i + EMBED_BATCH_SIZE < prepared.length) {
        await new Promise((r) => setTimeout(r, 500));
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

/**
 * Group similar fetch-body errors so the log summary stays short on a
 * 200-email batch. Normalizes away the per-call gmailId and exact text
 * payloads while keeping the failure mode visible.
 */
function categorizeError(msg: string): string {
  const httpMatch = msg.match(/^HTTP (\d{3})/);
  if (httpMatch) return `HTTP ${httpMatch[1]}`;
  if (/no valid google tokens/i.test(msg)) return "no_valid_google_tokens";
  if (/invalid_grant/i.test(msg)) return "invalid_grant";
  if (/Failed to refresh/i.test(msg)) return "token_refresh_failed";
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(msg)) return "network";
  if (/Unexpected token|JSON/i.test(msg)) return "json_parse";
  if (/base64|Buffer/i.test(msg)) return "base64_decode";
  return msg.slice(0, 60).replace(/[a-f0-9]{16,}/gi, "<id>");
}

/**
 * Pull the corpus of fullBody-populated outbound emails for this user
 * and run statistical signature detection. Caller persists the result
 * onto VoiceProfile.signatureLines.
 *
 * Wider sample than the per-run batch (up to 1000) — signature patterns
 * stabilize quickly so we don't need every email, just enough that the
 * 30% threshold separates signal from noise.
 */
const SIGNATURE_DETECTION_CORPUS_SIZE = 1000;

async function detectUserSignatureLines(
  prisma: PrismaClient,
  userId: string,
): Promise<string[]> {
  const bodies = await prisma.emailMessage.findMany({
    where: {
      userId,
      direction: "OUTBOUND",
      isAutomated: false,
      fullBody: { not: null },
    },
    orderBy: { occurredAt: "desc" },
    take: SIGNATURE_DETECTION_CORPUS_SIZE,
    select: { fullBody: true },
  });
  const texts = bodies
    .map((b) => b.fullBody)
    .filter((b): b is string => b !== null);
  const result = detectSignatureLines(texts);
  return result.lines;
}

export default voiceCorpusIndex;
