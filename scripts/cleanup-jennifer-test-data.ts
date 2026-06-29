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
 * - Apple Contacts rows with legitimate Gmail/Calendar history are
 *   retained and reclassified as MANUAL so retired sources disappear.
 * - Obvious Devon/dev/test contacts, email rows, inbox items, drafts,
 *   and associated derived rows.
 * - Derived assistant intelligence likely polluted by message imports.
 * - Contact.lastInteraction, recomputed from the remaining interactions.
 *
 * What this keeps:
 * - Gmail messages and interactions.
 * - Google Contacts, LinkedIn contacts, Calendar interactions.
 * - Apple Contacts rows that have legitimate Gmail/Calendar history,
 *   for manual review/merge instead of deletion.
 */
import dotenv from "dotenv";
import { ContactSource, Prisma, PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

dotenv.config({ path: ".env.local", override: true, quiet: true });
dotenv.config({ path: ".env", quiet: true });

const CONFIRM_VALUE = "jennifer-cleanup";
const DEFAULT_USER_EMAIL = "jaaker@stanford.edu";
const INSENSITIVE = "insensitive" as const;

const CONTACT_DEV_TEST_FILTERS: Prisma.ContactWhereInput[] = [
  { name: { contains: "devon", mode: INSENSITIVE } },
  { email: { contains: "devon", mode: INSENSITIVE } },
  { notes: { contains: "devon", mode: INSENSITIVE } },
  { howWeMet: { contains: "devon", mode: INSENSITIVE } },
  { name: { equals: "test", mode: INSENSITIVE } },
  { name: { equals: "testing", mode: INSENSITIVE } },
  { name: { startsWith: "apptest", mode: INSENSITIVE } },
  { name: { startsWith: "testdoc", mode: INSENSITIVE } },
  { email: { startsWith: "apptest", mode: INSENSITIVE } },
  { email: { startsWith: "scaltest", mode: INSENSITIVE } },
  { email: { startsWith: "test@", mode: INSENSITIVE } },
  { email: { startsWith: "testing@", mode: INSENSITIVE } },
  { email: { contains: "devontjsmith", mode: INSENSITIVE } },
];

const EMAIL_DEV_TEST_FILTERS: Prisma.EmailMessageWhereInput[] = [
  { fromEmail: { contains: "devon", mode: INSENSITIVE } },
  { toEmail: { contains: "devon", mode: INSENSITIVE } },
  { subject: { contains: "devon", mode: INSENSITIVE } },
  { fromEmail: { startsWith: "apptest", mode: INSENSITIVE } },
  { toEmail: { startsWith: "apptest", mode: INSENSITIVE } },
  { fromEmail: { startsWith: "scaltest", mode: INSENSITIVE } },
  { toEmail: { startsWith: "scaltest", mode: INSENSITIVE } },
  { fromEmail: { startsWith: "test@", mode: INSENSITIVE } },
  { toEmail: { startsWith: "test@", mode: INSENSITIVE } },
  { subject: { contains: "[TEST", mode: INSENSITIVE } },
];

const INBOX_DEV_TEST_FILTERS: Prisma.InboxItemWhereInput[] = [
  { contactName: { contains: "devon", mode: INSENSITIVE } },
  { contactName: { equals: "test", mode: INSENSITIVE } },
  { contactName: { equals: "testing", mode: INSENSITIVE } },
  { contactName: { startsWith: "apptest", mode: INSENSITIVE } },
];

const DRAFT_DEV_TEST_FILTERS: Prisma.DraftWhereInput[] = [
  { content: { contains: "devon", mode: INSENSITIVE } },
  { subjectLine: { contains: "devon", mode: INSENSITIVE } },
  { subjectLine: { contains: "[TEST", mode: INSENSITIVE } },
];

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requiredEnv("DATABASE_URL") }),
});

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

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
  };
}

function appleContactDeleteWhere(userId: string) {
  return {
    userId,
    source: ContactSource.APPLE_CONTACTS,
    interactions: {
      none: {
        ...nonMessageInteractionWhere(),
      },
    },
  };
}

function appleContactRetainWhere(userId: string): Prisma.ContactWhereInput {
  return {
    userId,
    source: ContactSource.APPLE_CONTACTS,
    interactions: {
      some: nonMessageInteractionWhere(),
    },
  };
}

function nonMessageInteractionWhere(): Prisma.InteractionWhereInput {
  return {
    NOT: {
      OR: [
        { channel: { in: ["iMessage", "SMS"] } },
        { sourceId: { startsWith: "imsg" } },
      ],
    },
  };
}

function devContactWhere(userId: string): Prisma.ContactWhereInput {
  return { userId, OR: CONTACT_DEV_TEST_FILTERS };
}

function devEmailWhere(userId: string): Prisma.EmailMessageWhereInput {
  return { userId, OR: EMAIL_DEV_TEST_FILTERS };
}

function devInboxWhere(userId: string): Prisma.InboxItemWhereInput {
  return { userId, OR: INBOX_DEV_TEST_FILTERS };
}

function devDraftWhere(userId: string): Prisma.DraftWhereInput {
  return { userId, OR: DRAFT_DEV_TEST_FILTERS };
}

function devInteractionWhere(
  userId: string,
  args: {
    gmailIds: string[];
    contactIds: string[];
  },
): Prisma.InteractionWhereInput {
  const filters: Prisma.InteractionWhereInput[] = [
    { subject: { contains: "devon", mode: INSENSITIVE } },
    { summary: { contains: "devon", mode: INSENSITIVE } },
    { subject: { contains: "[TEST", mode: INSENSITIVE } },
    { summary: { contains: "[TEST", mode: INSENSITIVE } },
  ];

  if (args.gmailIds.length > 0) {
    filters.push({ sourceId: { in: args.gmailIds } });
  }
  if (args.contactIds.length > 0) {
    filters.push({ contactId: { in: args.contactIds } });
  }

  return { userId, OR: filters };
}

function devActionItemWhere(
  userId: string,
  args: {
    gmailIds: string[];
    gmailThreadIds: string[];
  },
): Prisma.ActionItemWhereInput {
  const filters: Prisma.ActionItemWhereInput[] = [
    { title: { contains: "devon", mode: INSENSITIVE } },
    { context: { contains: "devon", mode: INSENSITIVE } },
    { title: { contains: "[TEST", mode: INSENSITIVE } },
    { context: { contains: "[TEST", mode: INSENSITIVE } },
  ];

  if (args.gmailIds.length > 0) {
    filters.push({
      sourceId: { in: args.gmailIds.map((gmailId) => `email:${gmailId}`) },
    });
  }
  if (args.gmailThreadIds.length > 0) {
    filters.push({ threadId: { in: args.gmailThreadIds } });
  }

  return { userId, OR: filters };
}

async function collectDevArtifacts(userId: string) {
  const [contacts, emails, inboxItems, drafts] = await Promise.all([
    prisma.contact.findMany({
      where: devContactWhere(userId),
      select: {
        id: true,
        name: true,
        email: true,
        source: true,
        company: true,
        lastInteraction: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.emailMessage.findMany({
      where: devEmailWhere(userId),
      select: {
        id: true,
        gmailId: true,
        threadId: true,
        fromEmail: true,
        toEmail: true,
        subject: true,
        direction: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: "desc" },
    }),
    prisma.inboxItem.findMany({
      where: devInboxWhere(userId),
      select: {
        id: true,
        channel: true,
        sourceSystem: true,
        status: true,
        contactName: true,
        triggerAt: true,
      },
      orderBy: { triggerAt: "desc" },
    }),
    prisma.draft.findMany({
      where: devDraftWhere(userId),
      select: {
        id: true,
        type: true,
        status: true,
        subjectLine: true,
        createdAt: true,
        contact: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const contactIds = contacts.map((contact) => contact.id);
  const emailIds = emails.map((email) => email.id);
  const gmailIds = emails.map((email) => email.gmailId);
  const gmailThreadIds = [
    ...new Set(emails.map((email) => email.threadId).filter((id): id is string => !!id)),
  ];
  const interactionWhere = devInteractionWhere(userId, { gmailIds, contactIds });

  const [interactions, lifeEventSignals, personFacts, actionItems] = await Promise.all([
    prisma.interaction.findMany({
      where: interactionWhere,
      select: {
        id: true,
        sourceId: true,
        subject: true,
        channel: true,
        occurredAt: true,
        contact: { select: { name: true, email: true } },
      },
      orderBy: { occurredAt: "desc" },
    }),
    prisma.lifeEventSignal.findMany({
      where: { userId, sourceType: "email", sourceRecordId: { in: emailIds } },
      select: { id: true, sourceRecordId: true, summary: true },
    }),
    prisma.personFact.findMany({
      where:
        contactIds.length > 0
          ? { userId, contactId: { in: contactIds } }
          : { userId, id: { in: [] } },
      select: { id: true, contactId: true, type: true, value: true, sourceSystem: true },
    }),
    prisma.actionItem.findMany({
      where: devActionItemWhere(userId, { gmailIds, gmailThreadIds }),
      select: { id: true, title: true, status: true, threadId: true, sourceId: true },
    }),
  ]);

  const feedItems = lifeEventSignals.length
    ? await prisma.feedItem.findMany({
        where: {
          userId,
          sourceRecordId: { in: lifeEventSignals.map((signal) => signal.id) },
        },
        select: { id: true, headline: true, sourceRecordId: true },
      })
    : [];

  return {
    contacts,
    emails,
    inboxItems,
    drafts,
    interactions,
    lifeEventSignals,
    feedItems,
    personFacts,
    actionItems,
    ids: {
      contactIds,
      emailIds,
      gmailIds,
      gmailThreadIds,
      inboxItemIds: inboxItems.map((item) => item.id),
      draftIds: drafts.map((draft) => draft.id),
      interactionIds: interactions.map((interaction) => interaction.id),
      lifeEventSignalIds: lifeEventSignals.map((signal) => signal.id),
      feedItemIds: feedItems.map((item) => item.id),
      personFactIds: personFacts.map((fact) => fact.id),
      actionItemIds: actionItems.map((item) => item.id),
    },
  };
}

async function collectPlan(userId: string) {
  const messageWhere = messageInteractionWhere(userId);
  const appleDeleteWhere = appleContactDeleteWhere(userId);
  const appleRetainWhere = appleContactRetainWhere(userId);
  const devArtifacts = await collectDevArtifacts(userId);

  const [
    messageInteractions,
    messageInteractionChannels,
    imessageThreads,
    imessageSyncStates,
    appleContactsTotal,
    appleContactsToDelete,
    appleContactsToReclassify,
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
    prisma.contact.count({ where: { userId, source: ContactSource.APPLE_CONTACTS } }),
    prisma.contact.count({ where: appleDeleteWhere }),
    prisma.contact.count({ where: appleRetainWhere }),
    prisma.contact.findMany({
      where: {
        userId,
        source: ContactSource.APPLE_CONTACTS,
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
      appleContactsToReclassify,
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
      devTestResidue: {
        contacts: devArtifacts.contacts.length,
        emailMessages: devArtifacts.emails.length,
        interactions: devArtifacts.interactions.length,
        inboxItems: devArtifacts.inboxItems.length,
        drafts: devArtifacts.drafts.length,
        lifeEventSignals: devArtifacts.lifeEventSignals.length,
        feedItems: devArtifacts.feedItems.length,
        personFacts: devArtifacts.personFacts.length,
        actionItems: devArtifacts.actionItems.length,
      },
    },
    devTestSamples: {
      contacts: devArtifacts.contacts.slice(0, 20),
      emailMessages: devArtifacts.emails.slice(0, 20),
      interactions: devArtifacts.interactions.slice(0, 20),
      inboxItems: devArtifacts.inboxItems.slice(0, 20),
      drafts: devArtifacts.drafts.slice(0, 20),
      actionItems: devArtifacts.actionItems.slice(0, 20),
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
  const appleRetainWhere = appleContactRetainWhere(userId);
  const devArtifacts = await collectDevArtifacts(userId);

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
        devFeedItems: await tx.feedItem.deleteMany({
          where: { id: { in: devArtifacts.ids.feedItemIds } },
        }),
        devLifeEventSignals: await tx.lifeEventSignal.deleteMany({
          where: { id: { in: devArtifacts.ids.lifeEventSignalIds } },
        }),
        devActionItems: await tx.actionItem.deleteMany({
          where: { id: { in: devArtifacts.ids.actionItemIds } },
        }),
        devDrafts: await tx.draft.deleteMany({
          where: { id: { in: devArtifacts.ids.draftIds } },
        }),
        devInboxItems: await tx.inboxItem.deleteMany({
          where: { id: { in: devArtifacts.ids.inboxItemIds } },
        }),
        devPersonFacts: await tx.personFact.deleteMany({
          where: { id: { in: devArtifacts.ids.personFactIds } },
        }),
        devEmailMessages: await tx.emailMessage.deleteMany({
          where: { id: { in: devArtifacts.ids.emailIds } },
        }),
        devInteractions: await tx.interaction.deleteMany({
          where: { id: { in: devArtifacts.ids.interactionIds } },
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
        retainedAppleContacts: await tx.contact.updateMany({
          where: appleRetainWhere,
          data: { source: ContactSource.MANUAL },
        }),
        devContacts: await tx.contact.deleteMany({
          where: { id: { in: devArtifacts.ids.contactIds } },
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
