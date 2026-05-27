/**
 * One-shot: walk existing NEWS_MENTION ContactChangelog rows through
 * the M0.x.10 affiliation gate and DISMISS the ones that don't pass.
 *
 * Why: the gate now runs at write-time (signal-detection worker), so
 * future false-positive name collisions never land. But rows written
 * BEFORE the gate landed are still surfacing in /feed and "Notes from
 * your assistant" as "Toby Smith - Top podcast episodes" style noise.
 * This script cleans the backlog using the same pure gate logic.
 *
 * Idempotent. Dismissed rows have status='DISMISSED' which the
 * observations + feed surfaces already filter against. Re-run is
 * safe — already-dismissed rows are skipped.
 *
 * Usage:
 *   npx tsx scripts/gate-existing-news-mentions.ts              # apply
 *   npx tsx scripts/gate-existing-news-mentions.ts --dry-run    # preview
 *   npx tsx scripts/gate-existing-news-mentions.ts --delete     # hard delete
 *
 * `--delete` removes the rows outright rather than marking dismissed.
 * Use only if you're confident — the dismissed flag is reversible.
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { articleMentionsAffiliation } from "../src/lib/research/news-mention-gate";

interface RunStats {
  scanned: number;
  passed: number;
  gated: number;
  alreadyDismissed: number;
  skippedNoTitle: number;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const hardDelete = process.argv.includes("--delete");
  const verbose = process.argv.includes("--verbose");

  console.log(
    `[gate-existing-news-mentions] start dryRun=${dryRun} hardDelete=${hardDelete}`,
  );

  // Pull every NEWS_MENTION row that isn't already dismissed.
  // oldValue holds the article title; newValue holds the URL. We
  // don't have the description on the row (we never persisted it),
  // so the gate only sees the title — strictly more conservative
  // than what the live worker now does.
  const rows = await prisma.contactChangelog.findMany({
    where: {
      type: "NEWS_MENTION",
      status: { not: "DISMISSED" },
    },
    include: {
      contact: {
        select: {
          id: true,
          name: true,
          company: true,
          role: true,
          tags: true,
          lastSeenScholarlyInstitution: true,
          profile: { select: { expertiseAreas: true } },
        },
      },
    },
  });

  const stats: RunStats = {
    scanned: rows.length,
    passed: 0,
    gated: 0,
    alreadyDismissed: 0,
    skippedNoTitle: 0,
  };

  const toAction: Array<{
    id: string;
    contactName: string;
    title: string;
    tokens: ReadonlyArray<string>;
  }> = [];

  for (const row of rows) {
    if (row.status === "DISMISSED") {
      stats.alreadyDismissed++;
      continue;
    }
    const title = row.oldValue ?? "";
    if (!title.trim()) {
      stats.skippedNoTitle++;
      continue;
    }
    const result = articleMentionsAffiliation(
      {
        company: row.contact.company,
        role: row.contact.role,
        scholarlyInstitution: row.contact.lastSeenScholarlyInstitution,
        tags: row.contact.tags,
        expertiseAreas: row.contact.profile?.expertiseAreas ?? [],
      },
      { title, description: null },
    );
    if (result.passes) {
      stats.passed++;
      if (verbose) {
        console.log(
          `[keep] ${row.contact.name} — "${title.slice(0, 60)}" (matched ${result.matchedToken})`,
        );
      }
    } else {
      stats.gated++;
      toAction.push({
        id: row.id,
        contactName: row.contact.name,
        title,
        tokens: result.tokensConsidered,
      });
    }
  }

  for (const t of toAction) {
    console.log(
      `[gate] ${t.contactName} — "${t.title.slice(0, 80)}" (considered=${t.tokens.length})`,
    );
  }

  if (!dryRun && toAction.length > 0) {
    const ids = toAction.map((t) => t.id);
    if (hardDelete) {
      await prisma.contactChangelog.deleteMany({ where: { id: { in: ids } } });
    } else {
      await prisma.contactChangelog.updateMany({
        where: { id: { in: ids } },
        data: { status: "DISMISSED", actedAt: new Date() },
      });
    }
  }

  console.log(
    `[gate-existing-news-mentions] done scanned=${stats.scanned} ` +
      `passed=${stats.passed} gated=${stats.gated} ` +
      `alreadyDismissed=${stats.alreadyDismissed} ` +
      `skippedNoTitle=${stats.skippedNoTitle} dryRun=${dryRun}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[gate-existing-news-mentions] failed:", err);
    process.exit(1);
  });
