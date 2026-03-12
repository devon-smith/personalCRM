import { prisma } from "@/lib/prisma";
import type { ChangelogType, ChangelogStatus } from "@/generated/prisma/client";

export interface ChangelogEntry {
  readonly id: string;
  readonly contactId: string;
  readonly contactName: string;
  readonly company: string | null;
  readonly type: ChangelogType;
  readonly field: string;
  readonly oldValue: string | null;
  readonly newValue: string | null;
  readonly source: string;
  readonly status: ChangelogStatus;
  readonly detectedAt: string;
}

/**
 * Get pending changelog entries for the user's dashboard.
 */
export async function getPendingChangelog(
  userId: string,
  limit: number = 10,
): Promise<readonly ChangelogEntry[]> {
  const entries = await prisma.contactChangelog.findMany({
    where: {
      userId,
      status: { in: ["PENDING", "SEEN"] },
    },
    include: {
      contact: {
        select: { name: true, company: true },
      },
    },
    orderBy: { detectedAt: "desc" },
    take: limit,
  });

  return entries.map((e) => ({
    id: e.id,
    contactId: e.contactId,
    contactName: e.contact.name,
    company: e.contact.company,
    type: e.type,
    field: e.field,
    oldValue: e.oldValue,
    newValue: e.newValue,
    source: e.source,
    status: e.status,
    detectedAt: e.detectedAt.toISOString(),
  }));
}

/**
 * Detect changes when a contact's data is updated from an external source.
 * Call this during LinkedIn reimport or enrichment.
 */
export async function detectChanges(
  userId: string,
  contactId: string,
  oldData: { readonly company: string | null; readonly role: string | null },
  newData: { readonly company: string | null; readonly role: string | null },
  source: string = "linkedin_reimport",
): Promise<void> {
  const changes: Array<{
    type: ChangelogType;
    field: string;
    oldValue: string | null;
    newValue: string | null;
  }> = [];

  if (
    newData.company &&
    oldData.company &&
    newData.company.toLowerCase() !== oldData.company.toLowerCase()
  ) {
    changes.push({
      type: "COMPANY_CHANGE",
      field: "company",
      oldValue: oldData.company,
      newValue: newData.company,
    });
  }

  if (
    newData.role &&
    oldData.role &&
    newData.role.toLowerCase() !== oldData.role.toLowerCase()
  ) {
    changes.push({
      type: "ROLE_CHANGE",
      field: "role",
      oldValue: oldData.role,
      newValue: newData.role,
    });
  }

  // If both company AND role changed, collapse into JOB_CHANGE
  if (changes.length === 2) {
    await prisma.contactChangelog.create({
      data: {
        userId,
        contactId,
        type: "JOB_CHANGE",
        field: "company,role",
        oldValue: `${oldData.role} at ${oldData.company}`,
        newValue: `${newData.role} at ${newData.company}`,
        source,
      },
    });
    return;
  }

  for (const change of changes) {
    await prisma.contactChangelog.create({
      data: {
        userId,
        contactId,
        type: change.type,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        source,
      },
    });
  }
}
