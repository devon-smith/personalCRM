/**
 * Inbox draft pre-populator (M0.9 task 5).
 *
 * For every OPEN InboxItem that doesn't already have a linked Draft,
 * generate a reply draft via Claude Sonnet and write it. The Draft
 * queue card on the dashboard surfaces these with an "✨ Auto-drafted
 * from inbox" badge so Jennifer can click into the modal pre-loaded
 * with the generated content, ready to edit + send.
 *
 * Idempotency: Draft.inboxItemId is UNIQUE. A second run can't
 * create a duplicate even if it re-processes the same inbox item.
 *
 * Cost shape: 20 items/run × ~$0.01 = ~$0.20/day. Daily cron at
 * 04:00 UTC (after memory-synthesis at 03:00, before observations-
 * generation at 06:00).
 *
 * Lifecycle (from the spec):
 *   - When the linked InboxItem flips to RESOLVED, leave the Draft
 *     alone — Jennifer may still want to send it.
 *   - Sending the draft → InboxItem auto-resolves via the existing
 *     onOutboundInteraction hook.
 *   - Dismissing the draft → InboxItem stays OPEN (the user chose
 *     not to reply via this surface).
 */
import type { Task } from "graphile-worker";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { createWorkerPrismaClient } from "../db.js";
import { generateDraft } from "../../src/lib/draft-generator";
import {
  buildDraftInputFromInboxItem,
  isEligibleForAutoDraft,
} from "../../src/lib/intelligence/inbox-draft-input";

const ITEMS_PER_RUN = 20;

interface PrepopulatePayload {
  userId?: string;
  /** Test/dev override to lift the per-run cap. Defaults to ITEMS_PER_RUN. */
  limit?: number;
}

interface RunSummary {
  scanned: number;
  drafted: number;
  failed: number;
  skipped: number;
}

const inboxDraftPrepopulate: Task = async (rawPayload, helpers) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    helpers.logger.debug(
      "inbox-draft-prepopulate: no ANTHROPIC_API_KEY, skipping",
    );
    return;
  }

  const payload = (rawPayload ?? {}) as PrepopulatePayload;
  const prisma = createWorkerPrismaClient();
  const limit = payload.limit ?? ITEMS_PER_RUN;

  try {
    const userIds = payload.userId
      ? [payload.userId]
      : (await prisma.user.findMany({ select: { id: true } })).map((u) => u.id);

    for (const userId of userIds) {
      const summary = await prepopulateForUser(prisma, userId, limit, helpers);
      helpers.logger.info(
        `inbox-draft-prepopulate: user=${userId} ` +
          `scanned=${summary.scanned} drafted=${summary.drafted} ` +
          `failed=${summary.failed} skipped=${summary.skipped}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
};

async function prepopulateForUser(
  prisma: PrismaClient,
  userId: string,
  limit: number,
  helpers: { logger: { warn: (msg: string) => void } },
): Promise<RunSummary> {
  // Pull OPEN inbox items with no linked draft yet. The unique
  // constraint on Draft.inboxItemId means we can simply check
  // `draft: null` in the where clause — no race between SELECT and
  // INSERT (the INSERT will fail if a parallel writer beat us).
  //
  // M0.x.2: skip items the classifier explicitly marked as not
  // needing a reply. Unclassified (needsResponse=null) still qualifies
  // — fail-open avoids missing a real reply because the worker
  // hadn't run yet.
  const candidates = await prisma.inboxItem.findMany({
    where: {
      userId,
      status: "OPEN",
      draft: null,
      OR: [{ needsResponse: null }, { needsResponse: true }],
    },
    orderBy: { triggerAt: "desc" },
    take: limit,
    select: {
      id: true,
      userId: true,
      contactId: true,
      contactName: true,
      channel: true,
      messagePreview: true,
      threadKey: true,
    },
  });

  const summary: RunSummary = {
    scanned: candidates.length,
    drafted: 0,
    failed: 0,
    skipped: 0,
  };

  for (const item of candidates) {
    if (!isEligibleForAutoDraft(item)) {
      summary.skipped++;
      continue;
    }

    const draftInput = buildDraftInputFromInboxItem({
      id: item.id,
      userId: item.userId,
      contactId: item.contactId,
      channel: item.channel,
      messagePreview: item.messagePreview,
      threadKey: item.threadKey,
    });
    if (!draftInput) {
      summary.skipped++;
      continue;
    }

    try {
      const result = await generateDraft(draftInput);
      const resolvedContactId = result.resolvedContactId ?? item.contactId;
      await prisma.draft.create({
        data: {
          userId: item.userId,
          contactId: resolvedContactId,
          inboxItemId: item.id,
          status: "DRAFT",
          // REPLY_EMAIL is the only DraftType that matches the
          // reply_email context the prepopulator always picks.
          type: "REPLY_EMAIL",
          tone: draftInput.tone,
          // generateDraft returns { quick, detailed, subjectLine }.
          // "detailed" is the full-length copy users see in the modal
          // — quick is for inline previews. Store detailed.
          content: result.detailed,
          subjectLine: result.subjectLine,
          threadKey: item.threadKey ?? undefined,
        },
      });
      summary.drafted++;
    } catch (err) {
      summary.failed++;
      helpers.logger.warn(
        `inbox-draft-prepopulate: failed item=${item.id} ` +
          `contact="${item.contactName}" — ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return summary;
}

export default inboxDraftPrepopulate;
