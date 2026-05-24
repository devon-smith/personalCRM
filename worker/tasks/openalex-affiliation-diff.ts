/**
 * Nightly OpenAlex affiliation diff (Milestone 3.5).
 *
 * Walks every contact that has an openAlexAuthorId, refetches their
 * OpenAlex profile, compares lastKnownInstitution against the
 * previously-cached value on Contact, and writes a ContactChangelog
 * entry whenever it changes.
 *
 * Idempotent on no-op days: a clean run touches lastSeenScholarlyInstitution
 * on every contact even when nothing changed, so re-running is cheap.
 *
 * Failures are per-contact (one bad OpenAlex lookup doesn't abort
 * the run). Surfaces are logged via helpers.logger.
 */
import type { Task } from "graphile-worker";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getAuthorWithRecentWorks } from "../../src/lib/research/openalex";
import { classifyAffiliation } from "../../src/lib/research/affiliation-diff";

const PER_RUN_CAP = 200;

const openAlexAffiliationDiff: Task = async (_payload, helpers) => {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    const contacts = await prisma.contact.findMany({
      where: { openAlexAuthorId: { not: null } },
      select: {
        id: true,
        userId: true,
        name: true,
        company: true,
        openAlexAuthorId: true,
        lastSeenScholarlyInstitution: true,
      },
      take: PER_RUN_CAP,
    });

    if (contacts.length === 0) {
      helpers.logger.debug("No contacts with openAlexAuthorId.");
      return;
    }

    helpers.logger.info(
      `Checking ${contacts.length} contact(s) for affiliation changes.`,
    );

    let changes = 0;
    let initial = 0;
    let failed = 0;

    for (const c of contacts) {
      if (!c.openAlexAuthorId) continue;

      try {
        const result = await getAuthorWithRecentWorks(c.openAlexAuthorId, 1);
        if (!result) continue;
        const current = result.author.lastKnownInstitution?.displayName ?? null;

        const diff = classifyAffiliation({
          previous: c.lastSeenScholarlyInstitution,
          current,
        });

        if (diff.kind === "no_change") continue;

        if (diff.kind === "initial_snapshot") {
          await prisma.contact.update({
            where: { id: c.id },
            data: { lastSeenScholarlyInstitution: diff.current },
          });
          initial++;
          continue;
        }

        // diff.kind === "changed" — write changelog AND update snapshot.
        await prisma.contactChangelog.create({
          data: {
            contactId: c.id,
            userId: c.userId,
            type: "COMPANY_CHANGE",
            field: "scholarlyInstitution",
            oldValue: diff.previous,
            newValue: diff.current,
            status: "PENDING",
          },
        });
        await prisma.contact.update({
          where: { id: c.id },
          data: { lastSeenScholarlyInstitution: diff.current },
        });
        changes++;
        helpers.logger.info(
          `  ${c.name}: ${diff.previous} → ${diff.current}`,
        );
      } catch (err) {
        failed++;
        helpers.logger.error(
          `  ${c.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    helpers.logger.info(
      `Done. ${changes} changed, ${initial} initial snapshots, ${failed} failed.`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

export default openAlexAffiliationDiff;
