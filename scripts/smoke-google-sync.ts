/**
 * Small real Google sync smoke test for the one-user launch path.
 *
 * Default:
 *   npm run data:smoke:google
 *
 * Options:
 *   npx tsx scripts/smoke-google-sync.ts --user-email=jaaker@stanford.edu
 *   npx tsx scripts/smoke-google-sync.ts --calendar-days=7
 *   npx tsx scripts/smoke-google-sync.ts --extract-actions
 *
 * This mutates normal sync state by running the real Gmail incremental
 * sync and a bounded Calendar sync. It does not delete data.
 */
import dotenv from "dotenv";
import { prisma } from "../src/lib/prisma";
import { extractActionItems } from "../src/lib/gmail/extract-actions";
import {
  runCalendarSyncForUser,
  runGmailSyncForUser,
} from "../src/lib/sync/google-sync-runs";

dotenv.config({ path: ".env.local", override: true, quiet: true });
dotenv.config({ path: ".env", quiet: true });

const DEFAULT_USER_EMAIL = "jaaker@stanford.edu";
const INSENSITIVE = "insensitive" as const;

interface Args {
  readonly userEmail: string;
  readonly calendarDays: number;
  readonly extractActions: boolean;
}

function parseArgs(): Args {
  let userEmail = DEFAULT_USER_EMAIL;
  let calendarDays = 7;
  let extractActions = false;

  for (const arg of process.argv.slice(2)) {
    if (arg === "--extract-actions") extractActions = true;
    else if (arg.startsWith("--user-email=")) {
      userEmail = arg.slice("--user-email=".length).trim() || DEFAULT_USER_EMAIL;
    } else if (arg.startsWith("--calendar-days=")) {
      const parsed = Number(arg.slice("--calendar-days=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        calendarDays = Math.min(90, Math.floor(parsed));
      }
    }
  }

  return { userEmail: userEmail.toLowerCase(), calendarDays, extractActions };
}

async function main() {
  const args = parseArgs();
  const user = await prisma.user.findUnique({
    where: { email: args.userEmail },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    throw new Error(`No user found for ${args.userEmail}`);
  }

  const before = await collectAudit(user.id);
  const gmail = await runGmailSyncForUser(user.id, "manual");
  const actionExtraction =
    args.extractActions && gmail.changedThreads.length > 0
      ? await extractActionItems(user.id, { changedThreads: gmail.changedThreads })
      : null;
  const calendar = await runCalendarSyncForUser(user.id, "manual", args.calendarDays);
  const after = await collectAudit(user.id);

  const findings = buildFindings(after);
  const report = {
    generatedAt: new Date().toISOString(),
    user: { email: user.email, name: user.name },
    options: args,
    gmail: {
      processed: gmail.processed,
      changedThreadCount: gmail.changedThreads.length,
      changedThreadsSample: gmail.changedThreads.slice(0, 5),
    },
    actionExtraction,
    calendar,
    before,
    after,
    findings,
  };

  console.log(JSON.stringify(report, null, 2));

  if (findings.some((finding) => finding.severity === "high")) {
    process.exitCode = 1;
  }
}

async function collectAudit(userId: string) {
  const [
    latestSyncRuns,
    sourceAudit,
    emailRange,
    recentEmailMessages,
    retiredResidue,
    devResidue,
  ] = await Promise.all([
    prisma.syncRun.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      take: 6,
      select: {
        source: true,
        trigger: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        itemsProcessed: true,
        metadata: true,
        error: true,
      },
    }),
    auditSources(userId),
    prisma.emailMessage.aggregate({
      where: { userId },
      _count: { _all: true },
      _min: { occurredAt: true },
      _max: { occurredAt: true },
    }),
    prisma.emailMessage.findMany({
      where: { userId },
      orderBy: { occurredAt: "desc" },
      take: 5,
      select: {
        fromEmail: true,
        toEmail: true,
        subject: true,
        direction: true,
        occurredAt: true,
        contact: { select: { name: true, email: true } },
      },
    }),
    auditRetiredResidue(userId),
    auditDevResidue(userId),
  ]);

  return {
    latestSyncRuns,
    sourceAudit,
    emailRange,
    recentEmailMessages,
    retiredResidue,
    devResidue,
  };
}

async function auditSources(userId: string) {
  const [contactsBySource, interactionsByChannel, inboxBySourceSystem] =
    await Promise.all([
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
        by: ["sourceSystem"],
        where: { userId },
        _count: { _all: true },
        orderBy: { sourceSystem: "asc" },
      }),
    ]);

  return { contactsBySource, interactionsByChannel, inboxBySourceSystem };
}

async function auditRetiredResidue(userId: string) {
  const [interactions, contacts, threads, syncStates] = await Promise.all([
    prisma.interaction.count({
      where: {
        userId,
        OR: [
          { channel: { in: ["iMessage", "SMS", "imessage", "sms", "whatsapp", "text"] } },
          { sourceId: { startsWith: "imsg" } },
        ],
      },
    }),
    prisma.contact.count({
      where: {
        userId,
        source: { in: ["APPLE_CONTACTS", "IMESSAGE", "WHATSAPP"] },
      },
    }),
    prisma.thread.count({
      where: { userId, source: { in: ["imessage", "sms", "whatsapp"] } },
    }),
    prisma.iMessageSyncState.count({ where: { userId } }),
  ]);

  return { interactions, contacts, threads, syncStates };
}

async function auditDevResidue(userId: string) {
  const [contacts, emailMessages, inboxItems, drafts] = await Promise.all([
    prisma.contact.count({
      where: {
        userId,
        OR: [
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
        ],
      },
    }),
    prisma.emailMessage.count({
      where: {
        userId,
        OR: [
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
        ],
      },
    }),
    prisma.inboxItem.count({
      where: {
        userId,
        OR: [
          { contactName: { contains: "devon", mode: INSENSITIVE } },
          { contactName: { equals: "test", mode: INSENSITIVE } },
          { contactName: { equals: "testing", mode: INSENSITIVE } },
          { contactName: { startsWith: "apptest", mode: INSENSITIVE } },
        ],
      },
    }),
    prisma.draft.count({
      where: {
        userId,
        OR: [
          { content: { contains: "devon", mode: INSENSITIVE } },
          { subjectLine: { contains: "devon", mode: INSENSITIVE } },
          { subjectLine: { contains: "[TEST", mode: INSENSITIVE } },
        ],
      },
    }),
  ]);

  return { contacts, emailMessages, inboxItems, drafts };
}

function buildFindings(audit: Awaited<ReturnType<typeof collectAudit>>) {
  const findings: Array<{
    severity: "high" | "medium" | "low";
    key: string;
    message: string;
  }> = [];

  const failedSyncRuns = audit.latestSyncRuns.filter((run) => run.status === "error");
  if (failedSyncRuns.length > 0) {
    findings.push({
      severity: "high",
      key: "sync_errors",
      message: `${failedSyncRuns.length} recent sync run(s) failed.`,
    });
  }

  const retiredCount =
    audit.retiredResidue.interactions +
    audit.retiredResidue.contacts +
    audit.retiredResidue.threads +
    audit.retiredResidue.syncStates;
  if (retiredCount > 0) {
    findings.push({
      severity: "high",
      key: "retired_residue_after_sync",
      message: `Retired source residue reappeared after sync (${retiredCount} rows/states).`,
    });
  }

  const devCount =
    audit.devResidue.contacts +
    audit.devResidue.emailMessages +
    audit.devResidue.inboxItems +
    audit.devResidue.drafts;
  if (devCount > 0) {
    findings.push({
      severity: "medium",
      key: "dev_test_residue_after_sync",
      message: `Dev/test indicators are present after sync (${devCount} rows).`,
    });
  }

  if ((audit.emailRange._count._all ?? 0) === 0) {
    findings.push({
      severity: "high",
      key: "no_email_messages",
      message: "No EmailMessage rows exist after Gmail sync.",
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
