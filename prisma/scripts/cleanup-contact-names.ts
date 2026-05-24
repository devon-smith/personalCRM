/**
 * One-off cleanup migration for Contact.name.
 *
 * Walks every contact in the database, runs `cleanContactName` over it, and
 * either prints a diff summary (--dry-run) or writes the cleaned name back
 * inside a single transaction.
 *
 * Usage:
 *   npx tsx prisma/scripts/cleanup-contact-names.ts --dry-run
 *   npx tsx prisma/scripts/cleanup-contact-names.ts --apply
 *   npx tsx prisma/scripts/cleanup-contact-names.ts --apply --user-id=<uid>
 *
 * The script is re-runnable. Idempotent: a clean name passes through unchanged.
 */
import "dotenv/config";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  cleanContactName,
  type NameFix,
} from "../../src/lib/contacts/clean-name";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

interface Args {
  apply: boolean;
  dryRun: boolean;
  userId: string | null;
  sample: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = { apply: false, dryRun: false, userId: null, sample: 10 };
  for (const a of args) {
    if (a === "--apply") out.apply = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--user-id=")) out.userId = a.split("=")[1];
    else if (a.startsWith("--sample=")) out.sample = parseInt(a.split("=")[1], 10);
  }
  if (!out.apply && !out.dryRun) out.dryRun = true; // safest default
  return out;
}

async function main() {
  const args = parseArgs();
  console.log(
    `cleanup-contact-names: mode=${args.apply ? "APPLY" : "DRY-RUN"}` +
      (args.userId ? ` user=${args.userId}` : "") +
      `\n`,
  );

  const contacts = await prisma.contact.findMany({
    where: args.userId ? { userId: args.userId } : undefined,
    select: { id: true, name: true, email: true, userId: true },
  });

  console.log(`Scanned ${contacts.length} contacts.\n`);

  const fixCounts: Record<NameFix, number> = {
    trim: 0,
    quotes: 0,
    "leading-symbols": 0,
    "last-first-reversal": 0,
    "email-as-name": 0,
    "inferred-from-email": 0,
    credentials: 0,
  };
  const samples: Array<{ before: string | null; after: string | null; fixes: NameFix[] }> = [];
  const updates: Array<{ id: string; name: string }> = [];
  let unchanged = 0;
  let droppedToNull = 0;

  for (const c of contacts) {
    const result = cleanContactName({ name: c.name, email: c.email });
    if (result.fixes.length === 0) {
      unchanged++;
      continue;
    }
    for (const f of result.fixes) fixCounts[f]++;
    if (samples.length < args.sample) {
      samples.push({ before: c.name, after: result.name, fixes: result.fixes });
    }
    if (result.name === null) {
      droppedToNull++;
      continue; // safety: never null-out a name in the cleanup, only fix it
    }
    if (result.name !== c.name) {
      updates.push({ id: c.id, name: result.name });
    }
  }

  // ─── Report ───────────────────────────────────────────────
  console.log("Fix breakdown:");
  for (const [fix, count] of Object.entries(fixCounts)) {
    if (count > 0) console.log(`  ${fix.padEnd(22)} ${count}`);
  }
  console.log(`\n  ${"unchanged".padEnd(22)} ${unchanged}`);
  console.log(`  ${"would write".padEnd(22)} ${updates.length}`);
  if (droppedToNull > 0) {
    console.log(`  ${"dropped-to-null (skipped)".padEnd(22)} ${droppedToNull}`);
  }

  if (samples.length > 0) {
    console.log(`\nSample diffs (first ${samples.length}):`);
    for (const s of samples) {
      console.log(`  ${JSON.stringify(s.before)} → ${JSON.stringify(s.after)}  [${s.fixes.join(", ")}]`);
    }
  }

  if (!args.apply) {
    console.log(`\nDry-run complete. Re-run with --apply to write changes.`);
    return;
  }

  if (updates.length === 0) {
    console.log(`\nNothing to write.`);
    return;
  }

  console.log(`\nApplying ${updates.length} updates in a single transaction...`);
  await prisma.$transaction(
    updates.map((u) =>
      prisma.contact.update({
        where: { id: u.id },
        data: { name: u.name },
      }),
    ),
  );
  console.log(`Done.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
