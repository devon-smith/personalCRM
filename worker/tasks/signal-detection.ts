/**
 * Nightly signal detection (Milestone 5.2). For each high-tier contact,
 * runs a Brave Search for recent web mentions and writes any novel hit
 * as a NEWS_MENTION ContactChangelog row — same surface the dashboard
 * + draft-generator already consume from JOB_CHANGE / ROLE_CHANGE.
 *
 * Constraints:
 *   - INNER_CIRCLE only by default (~30 contacts at single-user scale).
 *   - Skip contacts we already wrote a NEWS_MENTION for in the last
 *     7 days — Brave returns the same article repeatedly across days.
 *   - Skip on missing BRAVE_API_KEY (no spam, no error).
 *   - One query per contact (~30 queries/run, well under Brave's 2k/mo
 *     free tier even running daily).
 *
 * Cron: weekly Mon 04:55 UTC. Daily is overkill — news doesn't change
 * minute-to-minute and the dashboard surfaces are persistent.
 */
import type { Task } from "graphile-worker";
import { createWorkerPrismaClient } from "../db.js";
import {
  searchRecentMentions,
  type BraveSearchHit,
} from "../../src/lib/research/brave-search";

const TIER_FILTER = ["INNER_CIRCLE"];
const DEDUP_WINDOW_DAYS = 7;

const signalDetection: Task = async (_payload, helpers) => {
  if (!process.env.BRAVE_API_KEY) {
    helpers.logger.debug("BRAVE_API_KEY not set — skipping signal detection.");
    return;
  }

  const prisma = createWorkerPrismaClient();

  try {
    const contacts = await prisma.contact.findMany({
      where: { tier: { in: TIER_FILTER as ("INNER_CIRCLE" | "PROFESSIONAL")[] } },
      select: { id: true, userId: true, name: true, company: true },
    });

    if (contacts.length === 0) {
      helpers.logger.debug("No high-tier contacts.");
      return;
    }

    helpers.logger.info(`Scanning ${contacts.length} INNER_CIRCLE contact(s) for recent news`);

    let queried = 0;
    let written = 0;
    let skippedRecent = 0;
    let failed = 0;
    const dedupCutoff = new Date(Date.now() - DEDUP_WINDOW_DAYS * 86_400_000);

    for (const c of contacts) {
      try {
        // Query: "Name" company. Wrapping the name in quotes meaningfully
        // sharpens precision on common names; company anchors the
        // disambiguation.
        const query = c.company
          ? `"${c.name}" ${c.company}`
          : `"${c.name}"`;

        const hits = await searchRecentMentions(c.userId, query, "pm", 3);
        queried++;
        if (hits.length === 0) continue;

        // Take only the top hit per contact per run — surfacing multiple
        // news cards for the same person on the same day creates noise.
        const top = pickBestHit(hits);
        if (!top) continue;

        // Dedup against the last 7 days of NEWS_MENTION rows for this
        // contact, matched by URL — Brave often returns the same article
        // for a week+ as it ages out of "past month" filter.
        const existing = await prisma.contactChangelog.findFirst({
          where: {
            contactId: c.id,
            type: "NEWS_MENTION",
            newValue: top.url,
            detectedAt: { gte: dedupCutoff },
          },
        });
        if (existing) {
          skippedRecent++;
          continue;
        }

        await prisma.contactChangelog.create({
          data: {
            contactId: c.id,
            userId: c.userId,
            type: "NEWS_MENTION",
            field: "web_mention",
            oldValue: top.title.slice(0, 200),
            newValue: top.url,
            status: "PENDING",
            source: "brave_search",
          },
        });
        written++;
        helpers.logger.info(`  ${c.name}: ${top.title.slice(0, 80)}`);
      } catch (err) {
        failed++;
        helpers.logger.error(
          `  ${c.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    helpers.logger.info(
      `signal-detection: ${queried} queried, ${written} new mentions, ${skippedRecent} duplicates, ${failed} failed`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

/**
 * Heuristic best-hit picker. Brave already ranks by relevance, but we
 * skim out obvious noise (LinkedIn profile pages, the contact's own
 * personal website) since neither is a "news mention".
 */
function pickBestHit(hits: BraveSearchHit[]): BraveSearchHit | null {
  const cleaned = hits.filter((h) => {
    const u = h.url.toLowerCase();
    if (u.includes("linkedin.com/in/")) return false;
    if (u.includes("/profile/")) return false;
    if (u.endsWith(".pdf")) return false;
    return true;
  });
  return cleaned[0] ?? null;
}

export default signalDetection;
