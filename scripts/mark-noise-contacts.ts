/**
 * One-shot: scan every Contact through the noise detector and set
 * `isNoise=true` on matches.
 *
 * Idempotent. Re-running flips contacts both ways based on the
 * current detector — if heuristics tighten (a name leaves the
 * SYSTEM_NAME_PHRASES set), formerly-flagged real people get
 * restored. Pass `--dry-run` to preview without writing.
 *
 *   npx tsx scripts/mark-noise-contacts.ts
 *   npx tsx scripts/mark-noise-contacts.ts --dry-run
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { classifyNoiseContact } from "../src/lib/intelligence/noise-detector";

interface RunStats {
  scanned: number;
  newlyFlagged: number;
  newlyCleared: number;
  unchanged: number;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const verbose = process.argv.includes("--verbose");

  console.log(`[mark-noise-contacts] start dryRun=${dryRun}`);

  const contacts = await prisma.contact.findMany({
    select: { id: true, name: true, email: true, isNoise: true },
  });

  const stats: RunStats = {
    scanned: contacts.length,
    newlyFlagged: 0,
    newlyCleared: 0,
    unchanged: 0,
  };

  const flips: Array<{
    id: string;
    name: string;
    email: string | null;
    next: boolean;
    reasons: string[];
  }> = [];

  for (const c of contacts) {
    const { isNoise, reasons } = classifyNoiseContact({
      name: c.name,
      email: c.email,
    });
    if (isNoise === c.isNoise) {
      stats.unchanged += 1;
      continue;
    }
    flips.push({
      id: c.id,
      name: c.name,
      email: c.email,
      next: isNoise,
      reasons,
    });
    if (isNoise) stats.newlyFlagged += 1;
    else stats.newlyCleared += 1;
  }

  if (verbose || dryRun) {
    for (const flip of flips) {
      const dir = flip.next ? "FLAG" : "CLEAR";
      console.log(
        `[${dir}] ${flip.name} <${flip.email ?? ""}> ${flip.reasons.join(",")}`,
      );
    }
  }

  if (!dryRun && flips.length > 0) {
    const flagIds = flips.filter((f) => f.next).map((f) => f.id);
    const clearIds = flips.filter((f) => !f.next).map((f) => f.id);
    if (flagIds.length > 0) {
      await prisma.contact.updateMany({
        where: { id: { in: flagIds } },
        data: { isNoise: true },
      });
    }
    if (clearIds.length > 0) {
      await prisma.contact.updateMany({
        where: { id: { in: clearIds } },
        data: { isNoise: false },
      });
    }
  }

  console.log(
    `[mark-noise-contacts] done scanned=${stats.scanned} ` +
      `newly_flagged=${stats.newlyFlagged} newly_cleared=${stats.newlyCleared} ` +
      `unchanged=${stats.unchanged} dryRun=${dryRun}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[mark-noise-contacts] failed:", err);
    process.exit(1);
  });
