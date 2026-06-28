/**
 * Daily morning brief — assembles today's priorities, meetings,
 * and overnight signals into an HTML email and
 * saves it as a Gmail draft for the user to skim & send.
 *
 * Why a draft rather than a sent email: zero risk of spam-trapping
 * the user's own inbox, easy to disable (delete the draft), and
 * Jennifer's morning ritual is already "open Gmail" — finding a
 * pre-staged brief at the top is the natural touchpoint.
 *
 * Idempotency: AIGenerationLog rows tagged feature='morning_brief'
 * track per-user/per-day runs. If we already ran today for a user,
 * replace the prior draft (existingDraftId) instead of stacking.
 *
 * Cron: weekdays 13:30 UTC (~6:30 Pacific). Configured in worker/index.ts.
 */
import type { Task } from "graphile-worker";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  gatherMorningBrief,
  renderBriefHtml,
  renderBriefText,
  buildBriefSubject,
} from "../../src/lib/morning-brief";
import { createGmailDraft } from "../../src/lib/gmail/drafts";

interface MorningBriefPayload {
  /** Run for a specific user only — defaults to all users. */
  userId?: string;
  /** Force re-render even if today's brief already exists (replaces draft). */
  force?: boolean;
}

const morningBrief: Task = async (rawPayload, helpers) => {
  const payload = (rawPayload ?? {}) as MorningBriefPayload;
  const appBaseUrl =
    process.env.WEBHOOK_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3003";

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    const users = payload.userId
      ? await prisma.user.findMany({
          where: { id: payload.userId },
          select: { id: true, email: true, name: true },
        })
      : await prisma.user.findMany({
          where: { email: { not: null }, onboardingCompletedAt: { not: null } },
          select: { id: true, email: true, name: true },
        });

    if (users.length === 0) {
      helpers.logger.debug("No eligible users for morning brief.");
      return;
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const user of users) {
      if (!user.email) continue;

      const now = new Date();
      const today = now.toISOString().slice(0, 10);

      // Idempotency: did we already run today? If so, get the previous draft id.
      const priorRun = await prisma.aIGenerationLog.findFirst({
        where: {
          userId: user.id,
          feature: "morning_brief",
          createdAt: { gte: startOfDayUtc(now) },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, outputId: true },
      });

      if (priorRun && !payload.force) {
        helpers.logger.debug(
          `  morning-brief: skipped ${user.id} (already ran today: draft=${priorRun.outputId})`,
        );
        skipped++;
        continue;
      }

      try {
        const data = await gatherMorningBrief(user.id, appBaseUrl, now);
        if (!data) {
          helpers.logger.debug(`  morning-brief: ${user.id} no user email; skip`);
          skipped++;
          continue;
        }

        const subject = buildBriefSubject(data);
        const htmlBody = renderBriefHtml(data);
        const textBody = renderBriefText(data);

        const result = await createGmailDraft(user.id, {
          from: user.email,
          to: user.email,
          subject,
          body: textBody,
          htmlBody,
          existingDraftId: priorRun?.outputId ?? null,
        });

        await prisma.aIGenerationLog.create({
          data: {
            userId: user.id,
            feature: "morning_brief",
            model: "deterministic",
            inputRefs: [
              `date:${today}`,
              ...data.priorities.map((p) => `inboxItem:${p.id}`),
              ...data.meetings.map((m) => `event:${m.id}`),
              ...data.overnightSignals.map((s) => `changelog:${s.id}`),
            ],
            outputId: result.draftId,
            cacheHit: false,
          },
        });

        helpers.logger.info(
          `  morning-brief: ${user.id} → draft=${result.draftId} (priorities=${data.priorities.length} meetings=${data.meetings.length} signals=${data.overnightSignals.length})`,
        );
        sent++;
      } catch (err) {
        failed++;
        helpers.logger.error(
          `  morning-brief: ${user.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    helpers.logger.info(
      `morning-brief: ${sent} drafted, ${skipped} skipped, ${failed} failed`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

function startOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export default morningBrief;
