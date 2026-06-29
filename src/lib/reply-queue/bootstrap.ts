import { prisma } from "@/lib/prisma";
import {
  getReplyQueueInbox,
  type ReplyQueueInboxView,
} from "@/lib/reply-queue/inbox-items";
import { getGoogleSourceStatus } from "@/lib/source-status/google";

export interface ReplyQueueDraftContact {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  avatarUrl: string | null;
}

export interface ReplyQueueDraft {
  id: string;
  type: string;
  tone: string;
  content: string;
  subjectLine: string | null;
  status: string;
  createdAt: Date;
  inboxItemId: string | null;
  gmailDraftId: string | null;
  savedToGmailAt: Date | null;
  contact: ReplyQueueDraftContact;
}

export interface ReplyQueueGoogleAccount {
  needsReconnect: boolean;
  lastSyncedAt: string | null;
}

export async function getReplyQueueDrafts(
  userId: string,
  limit = 50,
): Promise<ReplyQueueDraft[]> {
  return prisma.draft.findMany({
    where: { userId, status: "DRAFT" },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 50),
    include: {
      contact: {
        select: {
          id: true,
          name: true,
          email: true,
          company: true,
          avatarUrl: true,
        },
      },
    },
  });
}

export async function getReplyQueueGoogleAccounts(
  userId: string,
): Promise<ReplyQueueGoogleAccount[]> {
  const status = await getGoogleSourceStatus(userId);
  return status.accounts.map((account) => ({
    needsReconnect: account.needsReconnect,
    lastSyncedAt: account.lastSyncedAt,
  }));
}

export async function getReplyQueueBootstrap(
  userId: string,
  options: {
    view?: ReplyQueueInboxView;
    draftLimit?: number;
  } = {},
) {
  const [inbox, drafts, googleAccounts] = await Promise.all([
    getReplyQueueInbox(userId, options.view ?? "needs-reply"),
    getReplyQueueDrafts(userId, options.draftLimit ?? 50),
    getReplyQueueGoogleAccounts(userId),
  ]);

  return {
    inbox,
    drafts: { drafts },
    dataHealth: { googleAccounts },
  };
}
