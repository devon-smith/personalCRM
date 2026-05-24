/**
 * Scan recent EmailMessage rows from LinkedIn notification addresses
 * for job-change / promotion signals, then write a ContactChangelog
 * row when a parsed person matches a known contact.
 *
 * Strategy:
 *   - Pull the last 7 days of EmailMessage rows from any LinkedIn-
 *     looking sender.
 *   - For each, run parseLinkedInSubject. Skip when null (vast majority).
 *   - For matches, do a name-based contact lookup. Skip when ambiguous
 *     (>1 contact with that name) or no match — false positives create
 *     phantom job changes that erode trust.
 *   - Dedupe against ContactChangelog: don't write the same job change
 *     twice (matched by contactId + newValue).
 *
 * Runs nightly at 04:55 UTC. Idempotent on repeat runs.
 */
import type { Task } from "graphile-worker";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  isLinkedInNotification,
  parseLinkedInSubject,
} from "../../src/lib/gmail/linkedin-notifications";

const SCAN_WINDOW_DAYS = 7;

const linkedinNotificationsScan: Task = async (_payload, helpers) => {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    const since = new Date(Date.now() - SCAN_WINDOW_DAYS * 86_400_000);

    const messages = await prisma.emailMessage.findMany({
      where: {
        occurredAt: { gte: since },
        direction: "INBOUND",
      },
      select: {
        id: true,
        userId: true,
        fromEmail: true,
        subject: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: "desc" },
    });

    const fromLinkedIn = messages.filter((m) => isLinkedInNotification(m.fromEmail));
    if (fromLinkedIn.length === 0) {
      helpers.logger.debug("No LinkedIn-source emails in the last 7 days.");
      return;
    }

    let parsed = 0;
    let matched = 0;
    let written = 0;
    let skippedAmbiguous = 0;
    let skippedDuplicate = 0;

    for (const m of fromLinkedIn) {
      const signal = parseLinkedInSubject(m.subject);
      if (!signal) continue;
      parsed++;

      // Name-based contact lookup. Match is intentionally strict: exact
      // name (case-insensitive) AND must be unique.
      const matches = await prisma.contact.findMany({
        where: {
          userId: m.userId,
          name: { equals: signal.name, mode: "insensitive" },
        },
        select: { id: true, name: true, company: true },
      });

      if (matches.length === 0) continue;
      if (matches.length > 1) {
        skippedAmbiguous++;
        continue;
      }
      matched++;
      const contact = matches[0];

      // Dedupe: don't write the same change twice. Match by contactId +
      // newValue + type within the last 60 days.
      const newValue = signal.newCompany ?? signal.newRole ?? "";
      const existing = await prisma.contactChangelog.findFirst({
        where: {
          contactId: contact.id,
          newValue,
          detectedAt: { gte: new Date(Date.now() - 60 * 86_400_000) },
        },
      });
      if (existing) {
        skippedDuplicate++;
        continue;
      }

      await prisma.contactChangelog.create({
        data: {
          contactId: contact.id,
          userId: m.userId,
          type: signal.kind === "promotion" ? "ROLE_CHANGE" : "JOB_CHANGE",
          field: signal.newCompany ? "company" : "role",
          oldValue: signal.newCompany ? contact.company : null,
          newValue,
          status: "PENDING",
          source: "linkedin_notification",
        },
      });
      written++;
      helpers.logger.info(
        `  ${contact.name}: ${signal.kind} → ${newValue} (from EmailMessage ${m.id})`,
      );
    }

    helpers.logger.info(
      `linkedin-scan: ${fromLinkedIn.length} LinkedIn emails, ${parsed} parsed, ${matched} matched contacts, ${written} written, ${skippedAmbiguous} ambiguous-name, ${skippedDuplicate} duplicates`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

export default linkedinNotificationsScan;
