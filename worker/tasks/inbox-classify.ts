/**
 * Inbox needs-response classifier (M0.x.2).
 *
 * For an InboxItem with no classification yet (or one explicitly queued
 * for reclassification), pull the latest inbound message body + short
 * thread context, run the Haiku classifier, write results back to
 * InboxItem.needsResponse + responseCategory + responseReason +
 * responseConfidence + classifiedAt.
 *
 * Triggered by:
 *  - onInboundInteraction (src/lib/inbox.ts) every time a new InboxItem
 *    is created or an existing OPEN item receives another inbound
 *  - scripts/classify-inbox-backfill.ts for the one-shot backlog walk
 *
 * Idempotency:
 *   - If the inbox item already has classifiedAt set and the latest
 *     message hash matches, the task no-ops. This protects against
 *     duplicate enqueues (e.g. a fast double-fire from sync).
 *
 * Cost: Haiku, max_tokens=200, ~150 input tokens per call — well
 *   under $0.0005/item. 500 daily inbound items still well under $1/day.
 */
import type { Task } from "graphile-worker";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  classifyResponse,
  CLASSIFIER_MODEL,
} from "../../src/lib/inbox/response-classifier.js";

interface ClassifyPayload {
  inboxItemId: string;
  /** Force reclassification even if classifiedAt is set */
  force?: boolean;
}

const inboxClassify: Task = async (rawPayload, helpers) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    helpers.logger.debug("inbox-classify: no ANTHROPIC_API_KEY, skipping");
    return;
  }

  const payload = (rawPayload ?? {}) as ClassifyPayload;
  if (!payload.inboxItemId) {
    helpers.logger.warn("inbox-classify: missing inboxItemId in payload");
    return;
  }

  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const item = await prisma.inboxItem.findUnique({
      where: { id: payload.inboxItemId },
      select: {
        id: true,
        userId: true,
        contactId: true,
        channel: true,
        threadKey: true,
        triggerInteractionId: true,
        triggerAt: true,
        messagePreview: true,
        classifiedAt: true,
        contactName: true,
        tier: true,
        contactEmail: true,
      },
    });
    if (!item) {
      helpers.logger.debug(
        `inbox-classify: item ${payload.inboxItemId} not found`,
      );
      return;
    }
    if (item.classifiedAt && !payload.force) {
      // Already classified. The body hash check would be more robust,
      // but for now skip — the auto-resolve hook handles thread state
      // and the override UI handles user disagreement.
      return;
    }

    // Prefer the EmailMessage body when present (email channel) — it
    // has the full body. Fall back to the latest messagePreview entry
    // for text/iMessage/LinkedIn channels.
    let messageBody = "";
    let subject: string | null = null;
    let threadContext: Array<{ role: "inbound" | "outbound"; text: string }> =
      [];

    if (item.channel === "email" && item.threadKey) {
      const recent = await prisma.emailMessage.findMany({
        where: {
          userId: item.userId,
          threadId: item.threadKey,
        },
        orderBy: { occurredAt: "desc" },
        take: 3,
        select: {
          direction: true,
          subject: true,
          snippet: true,
          occurredAt: true,
        },
      });
      // Latest inbound is what we classify. (Skip OUTBOUND so we don't
      // classify Jennifer's own message.)
      const latestInbound = recent.find((m) => m.direction === "INBOUND");
      if (latestInbound) {
        messageBody = latestInbound.snippet ?? "";
        subject = latestInbound.subject ?? null;
      }
      threadContext = recent
        .slice()
        .reverse()
        .filter((m) => m !== latestInbound)
        .map((m) => ({
          role:
            m.direction === "OUTBOUND"
              ? ("outbound" as const)
              : ("inbound" as const),
          text: m.snippet ?? "",
        }));
    }

    if (!messageBody) {
      const previews = Array.isArray(item.messagePreview)
        ? (item.messagePreview as Array<{ summary?: string }>)
        : [];
      if (previews.length > 0) {
        messageBody = previews[0]?.summary ?? "";
      }
    }

    if (!messageBody.trim()) {
      helpers.logger.debug(
        `inbox-classify: item ${item.id} has no body to classify`,
      );
      return;
    }

    const t0 = Date.now();
    const result = await classifyResponse({
      messageBody,
      subject,
      threadContext,
      // Tier is a decent stand-in for relationship type while the
      // voice corpus's relationship classifier matures.
      relationshipType: item.tier ?? null,
    });
    const latencyMs = Date.now() - t0;

    await prisma.inboxItem.update({
      where: { id: item.id },
      data: {
        needsResponse: result.needsResponse,
        responseConfidence: result.confidence,
        responseReason: result.reason,
        responseCategory: result.category,
        classifiedAt: new Date(),
      },
    });

    // Best-effort log; never throws.
    try {
      await prisma.aIGenerationLog.create({
        data: {
          userId: item.userId,
          feature: "inbox_classify",
          model: CLASSIFIER_MODEL,
          inputRefs: [`inboxItem:${item.id}`] as unknown as object,
          outputId: item.id,
          tokensIn: result.tokensIn ?? null,
          tokensOut: result.tokensOut ?? null,
          cacheHit: null,
          latencyMs,
        },
      });
    } catch (err) {
      helpers.logger.warn(
        `inbox-classify: AIGenerationLog write failed — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
};

export default inboxClassify;
