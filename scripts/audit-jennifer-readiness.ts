/**
 * Read-only launch audit for Jennifer's one-user deployment.
 *
 * Default:
 *   npm run data:audit:jennifer
 *
 * Options:
 *   npx tsx scripts/audit-jennifer-readiness.ts --user-email=jaaker@stanford.edu
 *   npx tsx scripts/audit-jennifer-readiness.ts --strict
 *
 * This script intentionally does not mutate data. Use
 * cleanup-jennifer-test-data.ts only after reviewing this audit and
 * taking a production DB backup.
 */
import dotenv from "dotenv";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

dotenv.config({ path: ".env.local", override: true, quiet: true });
dotenv.config({ path: ".env", quiet: true });

const DEFAULT_USER_EMAIL = "jaaker@stanford.edu";
const RETIRED_CHANNELS = ["iMessage", "SMS", "imessage", "sms", "whatsapp", "text"];
const RETIRED_SOURCES = ["imessage", "sms", "whatsapp"];
const DEV_TEST_TERMS = ["devon", "devontjsmith", "test"];
const SAMPLE_LIMIT = 20;

interface Args {
  readonly strict: boolean;
  readonly userEmail: string;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requiredEnv("DATABASE_URL") }),
});

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseArgs(): Args {
  let strict = false;
  let userEmail = DEFAULT_USER_EMAIL;

  for (const arg of process.argv.slice(2)) {
    if (arg === "--strict") strict = true;
    else if (arg.startsWith("--user-email=")) {
      userEmail = arg.slice("--user-email=".length).trim() || DEFAULT_USER_EMAIL;
    }
  }

  return { strict, userEmail: userEmail.toLowerCase() };
}

async function main() {
  const args = parseArgs();
  const user = await prisma.user.findUnique({
    where: { email: args.userEmail },
    select: { id: true, name: true, email: true, createdAt: true },
  });

  if (!user) {
    throw new Error(`No user found for ${args.userEmail}`);
  }

  const [
    userInventory,
    accountAudit,
    sourceAudit,
    retiredResidue,
    devResidue,
    syncAudit,
    recentTelemetry,
  ] = await Promise.all([
    auditUsers(args.userEmail),
    auditAccounts(user.id),
    auditSources(user.id),
    auditRetiredResidue(user.id),
    auditDevResidue(user.id),
    auditSyncState(user.id),
    auditRecentTelemetry(user.id),
  ]);

  const findings = buildFindings({
    targetEmail: args.userEmail,
    userInventory,
    accountAudit,
    retiredResidue,
    devResidue,
    syncAudit,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    targetUser: user,
    findings,
    userInventory,
    accountAudit,
    sourceAudit,
    retiredResidue,
    devResidue,
    syncAudit,
    recentTelemetry,
    nextSteps: [
      "Review high-risk findings before production deploy.",
      "Run cleanup-jennifer-test-data.ts in dry-run mode and compare counts.",
      "After cleanup, run one manual Gmail sync and Calendar sync, then re-run this audit.",
      "Use Settings usage telemetry after the first production week to tune cron/batch budgets.",
    ],
  };

  console.log(JSON.stringify(report, null, 2));

  if (args.strict && findings.some((finding) => finding.severity === "high")) {
    process.exitCode = 1;
  }
}

async function auditUsers(targetEmail: string) {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      _count: {
        select: {
          accounts: true,
          contacts: true,
          interactions: true,
          emailMessages: true,
          inboxItems: true,
          drafts: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return users.map((user) => ({
    ...user,
    isTargetUser: user.email?.toLowerCase() === targetEmail,
  }));
}

async function auditAccounts(userId: string) {
  const accounts = await prisma.account.findMany({
    where: { userId },
    select: {
      id: true,
      provider: true,
      providerAccountId: true,
      scope: true,
      expires_at: true,
      needsReconnect: true,
      lastRefreshAt: true,
      lastRefreshError: true,
    },
    orderBy: [{ provider: "asc" }, { providerAccountId: "asc" }],
  });

  const gmailSync = await prisma.gmailSyncState.findUnique({
    where: { userId },
    select: {
      syncEnabled: true,
      lastSyncAt: true,
      watchExpiration: true,
      additionalUserEmails: true,
      mutedThreads: true,
    },
  });

  return {
    accounts,
    gmailSync: gmailSync
      ? {
          ...gmailSync,
          mutedThreadCount: gmailSync.mutedThreads.length,
        }
      : null,
  };
}

async function auditSources(userId: string) {
  const [
    contactsBySource,
    interactionsByChannel,
    inboxByChannel,
    inboxBySourceSystem,
    emailDirection,
    draftsByType,
    draftsByStatus,
  ] = await Promise.all([
    prisma.contact.groupBy({
      by: ["source"],
      where: { userId },
      _count: { _all: true },
      orderBy: { source: "asc" },
    }),
    prisma.interaction.groupBy({
      by: ["channel"],
      where: { userId },
      _count: { _all: true },
      orderBy: { channel: "asc" },
    }),
    prisma.inboxItem.groupBy({
      by: ["channel"],
      where: { userId },
      _count: { _all: true },
      orderBy: { channel: "asc" },
    }),
    prisma.inboxItem.groupBy({
      by: ["sourceSystem"],
      where: { userId },
      _count: { _all: true },
      orderBy: { sourceSystem: "asc" },
    }),
    prisma.emailMessage.groupBy({
      by: ["direction"],
      where: { userId },
      _count: { _all: true },
      orderBy: { direction: "asc" },
    }),
    prisma.draft.groupBy({
      by: ["type"],
      where: { userId },
      _count: { _all: true },
      orderBy: { type: "asc" },
    }),
    prisma.draft.groupBy({
      by: ["status"],
      where: { userId },
      _count: { _all: true },
      orderBy: { status: "asc" },
    }),
  ]);

  return {
    contactsBySource,
    interactionsByChannel,
    inboxByChannel,
    inboxBySourceSystem,
    emailDirection,
    draftsByType,
    draftsByStatus,
  };
}

async function auditRetiredResidue(userId: string) {
  const [interactions, inboxItems, contacts, threads, syncStates] = await Promise.all([
    prisma.interaction.findMany({
      where: {
        userId,
        OR: [
          { channel: { in: RETIRED_CHANNELS } },
          { sourceId: { startsWith: "imsg" } },
        ],
      },
      select: {
        id: true,
        channel: true,
        subject: true,
        occurredAt: true,
        contact: { select: { name: true, email: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: SAMPLE_LIMIT,
    }),
    prisma.inboxItem.findMany({
      where: {
        userId,
        OR: [
          { channel: { in: RETIRED_CHANNELS } },
          { sourceSystem: { in: RETIRED_SOURCES } },
        ],
      },
      select: {
        id: true,
        channel: true,
        sourceSystem: true,
        status: true,
        contactName: true,
        triggerAt: true,
      },
      orderBy: { triggerAt: "desc" },
      take: SAMPLE_LIMIT,
    }),
    prisma.contact.findMany({
      where: {
        userId,
        source: { in: ["APPLE_CONTACTS", "IMESSAGE", "WHATSAPP"] },
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        source: true,
        lastInteraction: true,
      },
      orderBy: { updatedAt: "desc" },
      take: SAMPLE_LIMIT,
    }),
    prisma.thread.count({
      where: { userId, source: { in: RETIRED_SOURCES } },
    }),
    prisma.iMessageSyncState.count({ where: { userId } }),
  ]);

  return {
    sampleInteractions: interactions,
    sampleInboxItems: inboxItems,
    sampleContacts: contacts,
    retiredThreadCount: threads,
    iMessageSyncStateCount: syncStates,
  };
}

async function auditDevResidue(userId: string) {
  const containsTerm = DEV_TEST_TERMS.map((term) => ({
    OR: [
      { name: { contains: term, mode: "insensitive" as const } },
      { email: { contains: term, mode: "insensitive" as const } },
      { notes: { contains: term, mode: "insensitive" as const } },
      { howWeMet: { contains: term, mode: "insensitive" as const } },
    ],
  }));

  const [contacts, emailMessages, inboxItems, drafts] = await Promise.all([
    prisma.contact.findMany({
      where: { userId, OR: containsTerm },
      select: {
        id: true,
        name: true,
        email: true,
        source: true,
        company: true,
        lastInteraction: true,
      },
      orderBy: { updatedAt: "desc" },
      take: SAMPLE_LIMIT,
    }),
    prisma.emailMessage.findMany({
      where: {
        userId,
        OR: DEV_TEST_TERMS.flatMap((term) => [
          { fromEmail: { contains: term, mode: "insensitive" as const } },
          { toEmail: { contains: term, mode: "insensitive" as const } },
          { subject: { contains: term, mode: "insensitive" as const } },
        ]),
      },
      select: {
        id: true,
        fromEmail: true,
        toEmail: true,
        subject: true,
        direction: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: "desc" },
      take: SAMPLE_LIMIT,
    }),
    prisma.inboxItem.findMany({
      where: {
        userId,
        OR: DEV_TEST_TERMS.map((term) => ({
          contactName: { contains: term, mode: "insensitive" as const },
        })),
      },
      select: {
        id: true,
        channel: true,
        sourceSystem: true,
        status: true,
        contactName: true,
        triggerAt: true,
      },
      orderBy: { triggerAt: "desc" },
      take: SAMPLE_LIMIT,
    }),
    prisma.draft.findMany({
      where: {
        userId,
        OR: DEV_TEST_TERMS.flatMap((term) => [
          { content: { contains: term, mode: "insensitive" as const } },
          { subjectLine: { contains: term, mode: "insensitive" as const } },
        ]),
      },
      select: {
        id: true,
        type: true,
        status: true,
        subjectLine: true,
        createdAt: true,
        contact: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: SAMPLE_LIMIT,
    }),
  ]);

  return {
    sampleContacts: contacts,
    sampleEmailMessages: emailMessages,
    sampleInboxItems: inboxItems,
    sampleDrafts: drafts,
  };
}

async function auditSyncState(userId: string) {
  const [syncRuns, calendarWatchChannels, contactsCursors, emailRange] =
    await Promise.all([
      prisma.syncRun.groupBy({
        by: ["source", "trigger", "status"],
        where: {
          userId,
          startedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        },
        _count: { _all: true },
        _max: { finishedAt: true, startedAt: true },
        orderBy: [{ source: "asc" }, { trigger: "asc" }, { status: "asc" }],
      }),
      prisma.calendarWatchChannel.findMany({
        where: { userId },
        select: {
          calendarId: true,
          expiration: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: SAMPLE_LIMIT,
      }),
      prisma.contactsSyncCursor.findMany({
        where: { userId },
        select: {
          accountId: true,
          lastSyncAt: true,
          lastFullSyncAt: true,
        },
        orderBy: { lastSyncAt: "desc" },
      }),
      prisma.emailMessage.aggregate({
        where: { userId },
        _count: { _all: true },
        _min: { occurredAt: true },
        _max: { occurredAt: true },
      }),
    ]);

  return {
    syncRunsLast14Days: syncRuns,
    calendarWatchChannels,
    contactsCursors,
    emailRange,
  };
}

async function auditRecentTelemetry(userId: string) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [aiByFeature, providerByService, syncErrors] = await Promise.all([
    prisma.aIGenerationLog.groupBy({
      by: ["feature", "model"],
      where: { userId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { tokensIn: true, tokensOut: true },
      orderBy: [{ feature: "asc" }, { model: "asc" }],
    }),
    prisma.providerCallLog.groupBy({
      by: ["service", "operation"],
      where: { userId, createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: [{ service: "asc" }, { operation: "asc" }],
    }),
    prisma.syncRun.findMany({
      where: { userId, status: "error", startedAt: { gte: since } },
      select: {
        source: true,
        trigger: true,
        error: true,
        metadata: true,
        startedAt: true,
      },
      orderBy: { startedAt: "desc" },
      take: SAMPLE_LIMIT,
    }),
  ]);

  return {
    aiByFeature,
    providerByService,
    recentSyncErrors: syncErrors,
  };
}

function buildFindings(input: {
  readonly targetEmail: string;
  readonly userInventory: Awaited<ReturnType<typeof auditUsers>>;
  readonly accountAudit: Awaited<ReturnType<typeof auditAccounts>>;
  readonly retiredResidue: Awaited<ReturnType<typeof auditRetiredResidue>>;
  readonly devResidue: Awaited<ReturnType<typeof auditDevResidue>>;
  readonly syncAudit: Awaited<ReturnType<typeof auditSyncState>>;
}) {
  const findings: Array<{
    readonly severity: "high" | "medium" | "low";
    readonly key: string;
    readonly message: string;
  }> = [];

  const nonTargetUsers = input.userInventory.filter((user) => !user.isTargetUser);
  if (nonTargetUsers.length > 0) {
    findings.push({
      severity: "high",
      key: "extra_users",
      message: `${nonTargetUsers.length} non-target user row(s) exist in the database.`,
    });
  }

  const nonTargetGoogleAccounts = input.accountAudit.accounts.filter(
    (account) =>
      account.provider === "google" &&
      account.providerAccountId.includes("@") &&
      account.providerAccountId.toLowerCase() !== input.targetEmail,
  );
  if (nonTargetGoogleAccounts.length > 0) {
    findings.push({
      severity: "high",
      key: "google_account_mismatch",
      message: `${nonTargetGoogleAccounts.length} Google account(s) do not match ${input.targetEmail}.`,
    });
  }

  const additionalEmails = input.accountAudit.gmailSync?.additionalUserEmails ?? [];
  const devAdditionalEmails = additionalEmails.filter((email) =>
    DEV_TEST_TERMS.some((term) => email.toLowerCase().includes(term)),
  );
  if (devAdditionalEmails.length > 0) {
    findings.push({
      severity: "high",
      key: "dev_additional_user_emails",
      message: `Gmail direction aliases include likely Devon/test address(es): ${devAdditionalEmails.join(", ")}.`,
    });
  }

  const retiredCount =
    input.retiredResidue.sampleInteractions.length +
    input.retiredResidue.sampleInboxItems.length +
    input.retiredResidue.sampleContacts.length +
    input.retiredResidue.retiredThreadCount +
    input.retiredResidue.iMessageSyncStateCount;
  if (retiredCount > 0) {
    findings.push({
      severity: "medium",
      key: "retired_source_residue",
      message: "Retired iMessage/SMS/WhatsApp or Apple Contacts residue is still present.",
    });
  }

  const devCount =
    input.devResidue.sampleContacts.length +
    input.devResidue.sampleEmailMessages.length +
    input.devResidue.sampleInboxItems.length +
    input.devResidue.sampleDrafts.length;
  if (devCount > 0) {
    findings.push({
      severity: "medium",
      key: "dev_test_residue",
      message: "Devon/test indicator samples are present; review before launch.",
    });
  }

  if ((input.syncAudit.emailRange._count._all ?? 0) === 0) {
    findings.push({
      severity: "low",
      key: "no_email_messages",
      message: "No EmailMessage rows exist for the target user; run a Gmail sync before smoke testing replies.",
    });
  }

  return findings;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
