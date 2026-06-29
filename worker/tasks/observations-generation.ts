/**
 * Daily assistant-observations generation worker (M9.2).
 *
 * Generates 1-3 unprompted observations per user from existing
 * signals (unanswered inbound, stale open threads, recent life
 * events, dormant inner-circle contacts), to surface on the
 * dashboard's "Notes from your assistant" panel.
 *
 * Idempotent on the same day — if we already generated for a
 * contact + source pair today, don't duplicate. The
 * "createdAt < startOfToday + already exists" check is enforced
 * via the unique-tuple (userId, contactId, source) on createdAt
 * within the run.
 *
 * Daily cron at 06:00 UTC — well after the upstream workers
 * (memory at 03:00, mention at 03:30) so the signals it reads are
 * fresh.
 */
import type { Task } from "graphile-worker";
import { Prisma, type PrismaClient } from "../../src/generated/prisma/client";
import { createWorkerPrismaClient } from "../db.js";
import {
  collectSignals,
  phraseSignal,
  findEnumLikeToken,
} from "../../src/lib/intelligence/generate-observations";

interface ObservationsPayload {
  userId?: string;
}

const observationsGeneration: Task = async (rawPayload, helpers) => {
  const payload = (rawPayload ?? {}) as ObservationsPayload;
  const prisma = createWorkerPrismaClient();

  try {
    const userIds = payload.userId
      ? [payload.userId]
      : (await prisma.user.findMany({ select: { id: true } })).map((u) => u.id);

    for (const userId of userIds) {
      const summary = await generateForUser(prisma, userId, helpers.logger);
      helpers.logger.info(
        `observations-generation: user=${userId} ` +
          `signals=${summary.signals} created=${summary.created} ` +
          `skipped=${summary.skipped} leak_dropped=${summary.leakDropped}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
};

interface RunSummary {
  signals: number;
  created: number;
  skipped: number;
  /** Count of drafts dropped because findEnumLikeToken matched
   *  their content — alarm on regression (M0.9 task 1). */
  leakDropped: number;
}

interface TaskLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

async function generateForUser(
  prisma: PrismaClient,
  userId: string,
  logger: TaskLogger,
): Promise<RunSummary> {
  const summary: RunSummary = {
    signals: 0,
    created: 0,
    skipped: 0,
    leakDropped: 0,
  };

  const signals = await collectSignals(prisma, userId);
  summary.signals = signals.length;
  if (signals.length === 0) return summary;

  // Don't re-create the same (contactId, source) observation if one
  // was made within the last 7 days. Avoids the dashboard nagging
  // about the same stale thread daily.
  const recentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const existing = await prisma.assistantObservation.findMany({
    where: {
      userId,
      createdAt: { gte: recentCutoff },
      contactId: { in: signals.map((s) => s.contactId) },
      source: { in: signals.map((s) => s.source) },
    },
    select: { contactId: true, source: true },
  });
  const existingKeys = new Set(
    existing.map((e) => `${e.contactId}::${e.source}`),
  );

  for (const sig of signals) {
    const key = `${sig.contactId}::${sig.source}`;
    if (existingKeys.has(key)) {
      summary.skipped++;
      continue;
    }
    const draft = phraseSignal(sig);

    // Last-mile regression alarm: if the rendered observation
    // contains an enum-like token (snake_case word), some new
    // ChangelogType was added without a humanizer. Skip the write
    // so Jennifer never sees the leak; the warn log surfaces the
    // bug loud at the next CI run.
    const leak = findEnumLikeToken(draft.content);
    if (leak) {
      logger.warn(
        `observations-generation: dropped enum-leak observation ` +
          `(token="${leak}", source="${draft.source}", ` +
          `contactId="${draft.contactId}", content="${draft.content}")`,
      );
      summary.leakDropped++;
      continue;
    }

    await prisma.assistantObservation.create({
      data: {
        userId,
        content: draft.content,
        contactId: draft.contactId,
        source: draft.source,
        sourceRefs: draft.sourceRefs as Prisma.InputJsonValue,
      },
    });
    summary.created++;
  }
  return summary;
}

export default observationsGeneration;
