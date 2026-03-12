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

export async function getOverdueContacts(
  userId: string
): Promise<FollowUpContact[]> {
  const now = new Date();

  const contacts = await prisma.contact.findMany({
    where: { userId },
    include: {
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
    .map((c) => {
      const cadenceDays = getCadence(c.tier, c.followUpDays);
      const dueDate = getDueDate(c.lastInteraction, cadenceDays);
      const daysOverdue = Math.floor(
        (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
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
    })
    .filter((c) => c.daysOverdue > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

export async function getUpcomingFollowUps(
  userId: string,
  days: number = 7
): Promise<FollowUpContact[]> {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);

  const contacts = await prisma.contact.findMany({
    where: { userId },
    include: {
      interactions: {
        orderBy: { occurredAt: "desc" },
        take: 1,
        select: { summary: true, type: true },
      },
    },
  });

  return contacts
    .filter((c) => {
      // Skip freshly imported contacts with no interactions
      if (!c.lastInteraction && c.importedAt) return false;
      return true;
    })
    .map((c) => {
      const cadenceDays = getCadence(c.tier, c.followUpDays);
      const dueDate = getDueDate(c.lastInteraction, cadenceDays);
      const daysOverdue = Math.floor(
        (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
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
    })
    .filter((c) => c.daysOverdue <= 0 && dueDate(c) <= cutoff)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

function dueDate(c: FollowUpContact): Date {
  return c.dueDate;
}
