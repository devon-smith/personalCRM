/**
 * Remove Devon/local-test communication data from Jennifer's workspace.
 *
 * Default mode is a dry-run:
 *   npx tsx scripts/cleanup-jennifer-test-data.ts
 *
 * Apply mode is intentionally guarded:
 *   npx tsx scripts/cleanup-jennifer-test-data.ts --apply --confirm=jennifer-cleanup
 *
 * What this cleans:
 * - iMessage/SMS interactions and iMessage thread/sync state.
 * - Apple Contacts rows that have no remaining non-message history.
 * - Derived assistant intelligence likely polluted by message imports.
 * - Contact.lastInteraction, recomputed from the remaining interactions.
 *
 * What this keeps:
 * - Gmail messages and interactions.
 * - Google Contacts, LinkedIn contacts, Calendar interactions.
 * - Apple Contacts rows that have legitimate Gmail/Calendar history,
 *   for manual review/merge instead of deletion.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const CONFIRM_VALUE = "jennifer-cleanup";
const DEFAULT_USER_EMAIL = "jaaker@stanford.edu";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

interface Args {
  apply: boolean;
  confirm: string | null;
  userEmail: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const parsed: Args = {
    apply: false,
    confirm: null,
    userEmail: DEFAULT_USER_EMAIL,
  };

  for (const arg of args) {
    if (arg === "--apply") parsed.apply = true;
    else if (arg.startsWith("--confirm=")) parsed.confirm = arg.split("=")[1] ?? null;
    else if (arg.startsWith("--user-email=")) parsed.userEmail = arg.split("=")[1] ?? DEFAULT_USER_EMAIL;
  }

  return parsed;
}

function messageInteractionWhere(userId: string) {
  return {
    userId,
    OR: [
      { channel: { in: ["iMessage", "SMS"] } },
      { sourceId: { startsWith: "imsg" } },
    ],
  } as const;
}

function appleContactDeleteWhere(userId: string) {
  const messageOnly = [
    { channel: { in: ["iMessage", "SMS"] } },
    { sourceId: { startsWith: "imsg" } },
  ];

  return {
    userId,
    source: "APPLE_CONTACTS",
    interactions: {
      none: {
        NOT: {
          OR: messageOnly,
        },
      },
    },
  } as const;
}

async function collectPlan(userId: string) {
  const messageWhere = messageInteractionWhere(userId);
  const appleDeleteWhere = appleContactDeleteWhere(userId);

  const [
    messageInteractions,
    messageInteractionChannels,
    imessageThreads,
    imessageSyncStates,
    appleContactsTotal,
    appleContactsToDelete,
    appleContactsToKeep,
    savedQueries,
    assistantObservations,
    contactMemories,
    contactProfiles,
    relationshipInsights,
    contactEdges,
    dailyPriorityRows,
    inboxPriorityRows,
    meetingPrepRows,
    meetingPrepWebRows,
    meetingPersonSummaryRows,
    staleLastInteractionRows,
  ] = await Promise.all([
    prisma.interaction.count({ where: messageWhere }),
    prisma.interaction.groupBy({
      by: ["channel"],
      where: messageWhere,
      _count: { _all: true },
      orderBy: { channel: "asc" },
    }),
    prisma.thread.count({ where: { userId, source: "imessage" } }),
    prisma.iMessageSyncState.count({ where: { userId } }),
    prisma.contact.count({ where: { userId, source: "APPLE_CONTACTS" } }),
    prisma.contact.count({ where: appleDeleteWhere }),
    prisma.contact.findMany({
      where: {
        userId,
        source: "APPLE_CONTACTS",
        NOT: appleDeleteWhere,
      },
      select: {
        name: true,
        email: true,
        phone: true,
        interactions: {
          where: {
            NOT: {
              OR: [
                { channel: { in: ["iMessage", "SMS"] } },
                { sourceId: { startsWith: "imsg" } },
              ],
            },
          },
          select: { channel: true, subject: true, occurredAt: true },
          orderBy: { occurredAt: "desc" },
          take: 3,
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.savedQuery.count({ where: { userId } }),
    prisma.assistantObservation.count({ where: { userId } }),
    prisma.contactMemory.count({ where: { contact: { is: { userId } } } }),
    prisma.contactProfile.count({ where: { contact: { is: { userId } } } }),
    prisma.relationshipInsight.count({ where: { userId } }),
    prisma.contactEdge.count({ where: { userId } }),
    prisma.dailyPriorityQueue.count({ where: { userId } }),
    prisma.inboxPriorityItem.count({ where: { userId } }),
    prisma.meetingPrepCache.count({ where: { contact: { is: { userId } } } }),
    prisma.meetingPrepWebCache.count({ where: { contact: { is: { userId } } } }),
    prisma.meetingPersonSummaryCache.count({
      where: { contact: { is: { userId } } },
    }),
    prisma.contact.count({
      where: {
        userId,
        lastInteraction: { not: null },
        interactions: {
          every: {
            OR: [
              { channel: { in: ["iMessage", "SMS"] } },
              { sourceId: { startsWith: "imsg" } },
            ],
          },
        },
      },
    }),
  ]);

  return {
    delete: {
      messageInteractions,
      messageInteractionChannels,
      imessageThreads,
      imessageSyncStates,
      appleContactsToDelete,
      derivedRows: {
        savedQueries,
        assistantObservations,
        contactMemories,
        contactProfiles,
        relationshipInsights,
        contactEdges,
        dailyPriorityRows,
        inboxPriorityRows,
        meetingPrepRows,
        meetingPrepWebRows,
        meetingPersonSummaryRows,
      },
    },
    keepForManualReview: {
      appleContactsTotal,
      appleContactsToKeep: appleContactsToKeep.length,
      appleContacts: appleContactsToKeep,
    },
    recompute: {
      staleLastInteractionRows,
    },
  };
}

async function applyCleanup(userId: string) {
  const messageWhere = messageInteractionWhere(userId);
  const appleDeleteWhere = appleContactDeleteWhere(userId);

  const appleContactIds = await prisma.contact.findMany({
    where: appleDeleteWhere,
    select: { id: true },
  });

  return prisma.$transaction(
    async (tx) => {
      const results = {
        savedQueries: await tx.savedQuery.deleteMany({ where: { userId } }),
        assistantObservations: await tx.assistantObservation.deleteMany({
          where: { userId },
        }),
        contactEdges: await tx.contactEdge.deleteMany({ where: { userId } }),
        contactMemories: await tx.contactMemory.deleteMany({
          where: { contact: { is: { userId } } },
        }),
        contactProfiles: await tx.contactProfile.deleteMany({
          where: { contact: { is: { userId } } },
        }),
        relationshipInsights: await tx.relationshipInsight.deleteMany({
          where: { userId },
        }),
        dailyPriorityRows: await tx.dailyPriorityQueue.deleteMany({
          where: { userId },
        }),
        inboxPriorityRows: await tx.inboxPriorityItem.deleteMany({
          where: { userId },
        }),
        meetingPrepRows: await tx.meetingPrepCache.deleteMany({
          where: { contact: { is: { userId } } },
        }),
        meetingPrepWebRows: await tx.meetingPrepWebCache.deleteMany({
          where: { contact: { is: { userId } } },
        }),
        meetingPersonSummaryRows: await tx.meetingPersonSummaryCache.deleteMany({
          where: { contact: { is: { userId } } },
        }),
        imessageSyncStates: await tx.iMessageSyncState.deleteMany({
          where: { userId },
        }),
        messageInteractions: await tx.interaction.deleteMany({
          where: messageWhere,
        }),
        imessageThreads: await tx.thread.deleteMany({
          where: { userId, source: "imessage" },
        }),
        appleContacts: await tx.contact.deleteMany({
          where: { id: { in: appleContactIds.map((contact) => contact.id) } },
        }),
      };

      await tx.$executeRaw`
        UPDATE "Contact" AS contact
        SET "lastInteraction" = remaining."lastInteraction"
        FROM (
          SELECT "contactId", MAX("occurredAt") AS "lastInteraction"
          FROM "Interaction"
          WHERE "userId" = ${userId}
          GROUP BY "contactId"
        ) AS remaining
        WHERE contact."id" = remaining."contactId"
          AND contact."userId" = ${userId}
      `;

      await tx.$executeRaw`
        UPDATE "Contact" AS contact
        SET "lastInteraction" = NULL
        WHERE contact."userId" = ${userId}
          AND NOT EXISTS (
            SELECT 1
            FROM "Interaction" AS interaction
            WHERE interaction."contactId" = contact."id"
          )
      `;

      return results;
    },
    { timeout: 120_000 },
  );
}

async function main() {
  const args = parseArgs();
  const user = await prisma.user.findUnique({
    where: { email: args.userEmail },
    select: { id: true, name: true, email: true },
  });

  if (!user) {
    throw new Error(`No user found for ${args.userEmail}`);
  }

  console.log(
    `cleanup-jennifer-test-data: ${args.apply ? "APPLY" : "DRY-RUN"} for ${user.name ?? user.email} (${user.email})`,
  );

  const before = await collectPlan(user.id);
  console.log(JSON.stringify(before, null, 2));

  if (!args.apply) {
    console.log(`\nDry-run only. Re-run with --apply --confirm=${CONFIRM_VALUE} after taking a DB backup.`);
    return;
  }

  if (args.confirm !== CONFIRM_VALUE) {
    throw new Error(`Apply mode requires --confirm=${CONFIRM_VALUE}`);
  }

  const applied = await applyCleanup(user.id);
  console.log("\nApplied cleanup:");
  console.log(JSON.stringify(applied, null, 2));

  const after = await collectPlan(user.id);
  console.log("\nPost-cleanup plan should be near zero:");
  console.log(JSON.stringify(after, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
