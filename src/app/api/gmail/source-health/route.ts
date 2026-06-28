import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface GmailSourceHealthResponse {
  status: "connected" | "needs_reconnect" | "disconnected";
  accountCount: number;
  lastSyncAt: string | null;
  syncEnabled: boolean;
  watchExpiration: string | null;
  unmatchedSenderCount: number;
  emailMessages: {
    total: number;
    inbound: number;
    outbound: number;
    automated: number;
    matched: number;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
  };
  replyQueue: {
    open: number;
    needsReply: number;
    classifiedNoReply: number;
  };
  drafts: {
    localDrafts: number;
    savedToGmail: number;
    sentLast7Days: number;
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    accounts,
    syncState,
    totalEmail,
    inboundEmail,
    outboundEmail,
    automatedEmail,
    matchedEmail,
    lastInbound,
    lastOutbound,
    openInbox,
    needsReply,
    noReply,
    localDrafts,
    savedToGmail,
    sentLast7Days,
  ] = await Promise.all([
    prisma.account.findMany({
      where: { userId, provider: "google" },
      select: { needsReconnect: true, access_token: true },
    }),
    prisma.gmailSyncState.findUnique({ where: { userId } }),
    prisma.emailMessage.count({ where: { userId } }),
    prisma.emailMessage.count({ where: { userId, direction: "INBOUND" } }),
    prisma.emailMessage.count({ where: { userId, direction: "OUTBOUND" } }),
    prisma.emailMessage.count({ where: { userId, isAutomated: true } }),
    prisma.emailMessage.count({ where: { userId, contactId: { not: null } } }),
    prisma.emailMessage.findFirst({
      where: { userId, direction: "INBOUND" },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    }),
    prisma.emailMessage.findFirst({
      where: { userId, direction: "OUTBOUND" },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    }),
    prisma.inboxItem.count({
      where: { userId, channel: "email", status: "OPEN" },
    }),
    prisma.inboxItem.count({
      where: {
        userId,
        channel: "email",
        status: "OPEN",
        OR: [{ needsResponse: null }, { needsResponse: true }],
      },
    }),
    prisma.inboxItem.count({
      where: {
        userId,
        channel: "email",
        status: "OPEN",
        needsResponse: false,
      },
    }),
    prisma.draft.count({ where: { userId, status: "DRAFT" } }),
    prisma.draft.count({
      where: { userId, status: "DRAFT", gmailDraftId: { not: null } },
    }),
    prisma.draft.count({
      where: { userId, status: "SENT", sentAt: { gte: sevenDaysAgo } },
    }),
  ]);

  const hasGoogle = accounts.length > 0;
  const needsReconnect = accounts.some((a) => a.needsReconnect || !a.access_token);
  const status: GmailSourceHealthResponse["status"] = !hasGoogle
    ? "disconnected"
    : needsReconnect
      ? "needs_reconnect"
      : "connected";

  const unmatchedSenderCount = Array.isArray(syncState?.unmatchedSenders)
    ? (syncState.unmatchedSenders as unknown[]).length
    : 0;

  const response: GmailSourceHealthResponse = {
    status,
    accountCount: accounts.length,
    lastSyncAt: syncState?.lastSyncAt?.toISOString() ?? null,
    syncEnabled: syncState?.syncEnabled ?? false,
    watchExpiration: syncState?.watchExpiration?.toISOString() ?? null,
    unmatchedSenderCount,
    emailMessages: {
      total: totalEmail,
      inbound: inboundEmail,
      outbound: outboundEmail,
      automated: automatedEmail,
      matched: matchedEmail,
      lastInboundAt: lastInbound?.occurredAt.toISOString() ?? null,
      lastOutboundAt: lastOutbound?.occurredAt.toISOString() ?? null,
    },
    replyQueue: {
      open: openInbox,
      needsReply,
      classifiedNoReply: noReply,
    },
    drafts: {
      localDrafts,
      savedToGmail,
      sentLast7Days,
    },
  };

  return NextResponse.json(response);
}
