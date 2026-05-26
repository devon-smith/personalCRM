/**
 * Per-email mention extraction worker (M7.2 expansion).
 *
 * Walks unprocessed outbound emails with fullBody populated, runs
 * Claude Haiku entity recognition over each body, matches extracted
 * names to Contact rows, and writes:
 *   1. `mentionedContactIds` + `mentionsProcessedAt` on EmailMessage
 *      (per-email cache — never re-process the same email)
 *   2. `mentioned` edges in ContactEdge between the recipient and
 *      each mentioned contact
 *
 * Throttled to 50 emails per run. Daily cron — chews through a 5K
 * backlog in ~100 days. Edges accumulate; the graph gets richer
 * over time.
 *
 * Cost shape: 50 × $0.001 ≈ $0.05/run. Annual: ~$18 at the daily
 * cap.
 */
import type { Task } from "graphile-worker";
import { PrismaClient, Prisma } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  extractMentions,
  matchNameToContact,
} from "../../src/lib/intelligence/extract-mentions";

const EMAILS_PER_RUN = 50;

interface MentionPayload {
  userId?: string;
}

const mentionExtraction: Task = async (rawPayload, helpers) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    helpers.logger.debug("mention-extraction: no ANTHROPIC_API_KEY, skipping");
    return;
  }

  const payload = (rawPayload ?? {}) as MentionPayload;
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    const userIds = payload.userId
      ? [payload.userId]
      : (await prisma.user.findMany({ select: { id: true } })).map((u) => u.id);

    for (const userId of userIds) {
      const summary = await extractForUser(prisma, userId, helpers);
      helpers.logger.info(
        `mention-extraction: user=${userId} processed=${summary.processed} ` +
          `with_mentions=${summary.withMentions} edges_written=${summary.edgesWritten} ` +
          `failed=${summary.failed}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
};

interface RunSummary {
  processed: number;
  withMentions: number;
  edgesWritten: number;
  failed: number;
}

async function extractForUser(
  prisma: PrismaClient,
  userId: string,
  helpers: { logger: { info: (msg: string) => void } },
): Promise<RunSummary> {
  const summary: RunSummary = {
    processed: 0,
    withMentions: 0,
    edgesWritten: 0,
    failed: 0,
  };

  // Pull unprocessed outbound emails with bodies + the recipient
  // contact resolution joined in one round-trip.
  const emails = await prisma.emailMessage.findMany({
    where: {
      userId,
      direction: "OUTBOUND",
      isAutomated: false,
      mentionsProcessedAt: null,
      fullBody: { not: null },
      contactId: { not: null },
    },
    orderBy: { occurredAt: "desc" },
    take: EMAILS_PER_RUN,
    select: {
      id: true,
      fullBody: true,
      contactId: true,
      contactName: true,
    },
  });

  if (emails.length === 0) {
    helpers.logger.info(`mention-extraction: user=${userId} nothing to process`);
    return summary;
  }

  // Pull all user's contacts once for name matching. ~30K rows worst
  // case; fine to hold in memory for the run.
  const allContacts = await prisma.contact.findMany({
    where: { userId },
    select: { id: true, name: true },
  });

  for (const email of emails) {
    summary.processed++;
    const body = email.fullBody;
    if (!body) {
      summary.failed++;
      continue;
    }

    const result = await extractMentions({
      body,
      excludeNames: email.contactName ? [email.contactName] : [],
    });

    if (!result) {
      summary.failed++;
      // Don't mark as processed — let the next run retry.
      continue;
    }

    // Match each extracted name to a contact, dedup, exclude the
    // recipient (already an explicit edge via mutual_thread).
    const matchedIds = new Set<string>();
    for (const name of result.names) {
      const id = matchNameToContact(name, allContacts);
      if (id && id !== email.contactId) matchedIds.add(id);
    }
    const mentionedContactIds = Array.from(matchedIds);

    await prisma.emailMessage.update({
      where: { id: email.id },
      data: {
        mentionedContactIds,
        mentionsProcessedAt: new Date(),
      },
    });

    if (mentionedContactIds.length === 0) continue;
    summary.withMentions++;

    // Write `mentioned` edges between recipient and each matched
    // contact. Canonical ordering (from < to) so we don't double-
    // count. Strength 0.4 — softer signal than mutual_thread because
    // a name-drop doesn't guarantee an actual relationship between
    // those two people; just that one was on the other's mind.
    const recipientId = email.contactId;
    if (!recipientId) continue;
    for (const mentionedId of mentionedContactIds) {
      const [from, to] =
        recipientId < mentionedId
          ? [recipientId, mentionedId]
          : [mentionedId, recipientId];
      await prisma.contactEdge.upsert({
        where: {
          fromContactId_toContactId_edgeType: {
            fromContactId: from,
            toContactId: to,
            edgeType: "mentioned",
          },
        },
        create: {
          userId,
          fromContactId: from,
          toContactId: to,
          edgeType: "mentioned",
          strength: 0.4,
          observationCount: 1,
          evidence: {
            firstObservedInEmail: email.id,
          } as Prisma.InputJsonValue,
        },
        update: {
          observationCount: { increment: 1 },
          lastReinforcedAt: new Date(),
        },
      });
      summary.edgesWritten++;
    }
  }

  return summary;
}

export default mentionExtraction;
