/**
 * Life event extraction worker (M0.x.3).
 *
 * Two trigger modes:
 *   - Payload-targeted: `{ emailMessageId }` — runs the extractor on
 *     one specific row. Used by the gmail-sync hook for new inbound
 *     mail.
 *   - Cron-batch: no payload — scans up to BATCH_SIZE rows where
 *     lifeEventProcessedAt IS NULL and processes them in order.
 *     Chews through any backlog (e.g. after a fresh deploy).
 *
 * Output:
 *   - Always sets EmailMessage.lifeEventProcessedAt = now() so we
 *     don't reprocess the same row.
 *   - Creates a LifeEventSignal row only when the extractor returns
 *     hasEvent=true. Most messages produce no signal — that's correct.
 *
 * Cost: Haiku, max_tokens=250. ~50 inbound emails/day × $0.0005 ≈
 *   $0.025/day. These signals feed assistant observations; they no
 *   longer fan out into a separate FeedItem aggregation path.
 */
import type { Task } from "graphile-worker";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  extractLifeEvent,
  LIFE_EVENT_MODEL,
} from "../../src/lib/feed/extract-life-events.js";

const BATCH_SIZE = 25;

interface ExtractPayload {
  /** Process one specific row (sync hook) */
  emailMessageId?: string;
}

const extractLifeEventsTask: Task = async (rawPayload, helpers) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    helpers.logger.debug(
      "extract-life-events: no ANTHROPIC_API_KEY, skipping",
    );
    return;
  }

  const payload = (rawPayload ?? {}) as ExtractPayload;
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const rows = payload.emailMessageId
      ? await prisma.emailMessage.findMany({
          where: {
            id: payload.emailMessageId,
            direction: "INBOUND",
            lifeEventProcessedAt: null,
          },
          select: rowSelect(),
        })
      : await prisma.emailMessage.findMany({
          where: {
            direction: "INBOUND",
            lifeEventProcessedAt: null,
            // Only attempt extraction on rows tied to a known contact
            // — otherwise we have no contactId to attach the signal to.
            contactId: { not: null },
            // Skip automated mail outright; the extractor would say
            // hasEvent=false for these anyway, but a per-row Haiku
            // call still costs.
            isAutomated: false,
          },
          orderBy: { occurredAt: "desc" },
          take: BATCH_SIZE,
          select: rowSelect(),
        });

    let detected = 0;
    let processed = 0;
    let skipped = 0;

    for (const row of rows) {
      if (!row.contactId) {
        skipped++;
        continue;
      }
      const text = row.snippet ?? row.fullBody ?? "";
      const t0 = Date.now();
      const result = await extractLifeEvent({
        body: text,
        subject: row.subject,
        fromName: row.fromName,
      });
      const latencyMs = Date.now() - t0;

      if (result.hasEvent && result.summary) {
        await prisma.lifeEventSignal.create({
          data: {
            userId: row.userId,
            contactId: row.contactId,
            signalType: result.eventType ?? "milestone",
            summary: result.summary,
            sourceType: "email",
            sourceRecordId: row.id,
            body: text.slice(0, 2000),
          },
        });
        detected++;
      }

      await prisma.emailMessage.update({
        where: { id: row.id },
        data: { lifeEventProcessedAt: new Date() },
      });
      processed++;

      try {
        await prisma.aIGenerationLog.create({
          data: {
            userId: row.userId,
            feature: "life_event_extract",
            model: LIFE_EVENT_MODEL,
            inputRefs: [`emailMessage:${row.id}`] as unknown as object,
            outputId: row.id,
            tokensIn: result.tokensIn ?? null,
            tokensOut: result.tokensOut ?? null,
            cacheHit: null,
            latencyMs,
          },
        });
      } catch (err) {
        helpers.logger.warn(
          `extract-life-events: AIGenerationLog write failed — ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    helpers.logger.info(
      `extract-life-events: processed=${processed} detected=${detected} skipped=${skipped}`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

function rowSelect() {
  return {
    id: true,
    userId: true,
    contactId: true,
    subject: true,
    snippet: true,
    fullBody: true,
    fromName: true,
  } as const;
}

export default extractLifeEventsTask;
