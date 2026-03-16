import { prisma } from "@/lib/prisma";
import type { FollowUpContact } from "@/lib/types";

export type { FollowUpContact } from "@/lib/types";

const DEFAULT_CADENCE: Record<string, number> = {
  INNER_CIRCLE: 14,
  PROFESSIONAL: 30,
  ACQUAINTANCE: 90,
};

function getCadence(tier: string, followUpDays: number | null): number {
  return followUpDays ?? DEFAULT_CADENCE[tier] ?? 30;
}

function getDueDate(lastInteraction: Date | null, cadenceDays: number): Date {
  if (!lastInteraction) return new Date(0); // always overdue if never contacted
  const due = new Date(lastInteraction);
  due.setDate(due.getDate() + cadenceDays);
  return due;
}

function toFollowUpContact(
  c: {
    id: string;
    name: string;
    email: string | null;
    company: string | null;
    role: string | null;
    tier: string;
    avatarUrl: string | null;
    lastInteraction: Date | null;
    followUpDays: number | null;
    importedAt: Date | null;
    interactions: { summary: string | null; type: string }[];
  },
  now: Date,
): FollowUpContact {
  const cadenceDays = getCadence(c.tier, c.followUpDays);
  const dueDate = getDueDate(c.lastInteraction, cadenceDays);
  const daysOverdue = Math.floor(
    (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  const lastInt = c.interactions[0] ?? null;

  return {
    id: c.id,
    name: c.name,
    email: c.email,
    company: c.company,
    role: c.role,
    tier: c.tier,
    avatarUrl: c.avatarUrl,
    lastInteraction: c.lastInteraction,
    followUpDays: c.followUpDays,
    cadenceDays,
    daysOverdue,
    dueDate,
    lastInteractionSummary: lastInt?.summary ?? null,
    lastInteractionType: lastInt?.type ?? null,
  };
}

export async function getOverdueContacts(
  userId: string,
): Promise<FollowUpContact[]> {
  const now = new Date();

  // Compute the cutoff: contacts whose lastInteraction is older than their
  // shortest possible cadence (14 days for INNER_CIRCLE) are candidates.
  // We over-fetch slightly and filter precisely in JS, but the DB does the
  // heavy lifting by excluding recently-active contacts.
  const maxCadenceCutoff = new Date(now);
  maxCadenceCutoff.setDate(maxCadenceCutoff.getDate() - 14); // shortest cadence

  const contacts = await prisma.contact.findMany({
    where: {
      userId,
      OR: [
        // Contacts with old interactions (potentially overdue)
        { lastInteraction: { lt: maxCadenceCutoff } },
        // Contacts with no interactions and no import date (always overdue)
        { lastInteraction: null, importedAt: null },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      company: true,
      role: true,
      tier: true,
      avatarUrl: true,
      lastInteraction: true,
      followUpDays: true,
      importedAt: true,
      interactions: {
        orderBy: { occurredAt: "desc" },
        take: 1,
        select: { summary: true, type: true },
      },
    },
  });

  return contacts
    .filter((c) => {
      // Skip freshly imported contacts with no interactions — they're "New"
      if (!c.lastInteraction && c.importedAt) return false;
      return true;
    })
    .map((c) => toFollowUpContact(c, now))
    .filter((c) => c.daysOverdue > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

export async function getUpcomingFollowUps(
  userId: string,
  days: number = 7,
): Promise<FollowUpContact[]> {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);

  // Only fetch contacts with recent-ish interactions that might be coming due soon
  // Max cadence is 90 days, so contacts last interacted within 90+days window are candidates
  const lookbackCutoff = new Date(now);
  lookbackCutoff.setDate(lookbackCutoff.getDate() - (90 + days));

  const contacts = await prisma.contact.findMany({
    where: {
      userId,
      lastInteraction: { gte: lookbackCutoff },
    },
    select: {
      id: true,
      name: true,
      email: true,
      company: true,
      role: true,
      tier: true,
      avatarUrl: true,
      lastInteraction: true,
      followUpDays: true,
      importedAt: true,
      interactions: {
        orderBy: { occurredAt: "desc" },
        take: 1,
        select: { summary: true, type: true },
      },
    },
  });

  return contacts
    .filter((c) => {
      if (!c.lastInteraction && c.importedAt) return false;
      return true;
    })
    .map((c) => toFollowUpContact(c, now))
    .filter((c) => c.daysOverdue <= 0 && c.dueDate <= cutoff)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}
