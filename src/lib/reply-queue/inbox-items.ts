import { getThreadsWithDrafts } from "@/lib/gmail/drafts";
import { computePriority } from "@/lib/inbox-priority";
import { prisma } from "@/lib/prisma";

export type ReplyQueueInboxView = "needs-reply" | "all";

export interface ReplyQueueMessagePreview {
  summary?: string;
  occurredAt?: string;
  channel?: string;
  [key: string]: unknown;
}

export interface ReplyQueueInboxItem {
  id: string;
  contactId: string;
  contactName: string;
  company: string | null;
  tier: string;
  channel: string;
  threadKey: string;
  isGroupChat: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
  contactLinkedinUrl: string | null;
  triggerAt: string;
  lastInboundAt: string;
  messagePreview: ReplyQueueMessagePreview[];
  messageCount: number;
  status: string;
  hasDraft: boolean;
  priority: "high" | "medium" | "low";
  priorityScore: number;
  priorityReason: string;
  sourceSystem: string | null;
  sourceRecordIds: string[];
  triggerInteractionId: string | null;
  needsResponse: boolean | null;
  responseConfidence: number | null;
  responseReason: string | null;
  responseCategory: string | null;
  classifiedAt: string | null;
}

export interface ReplyQueueInboxData {
  items: ReplyQueueInboxItem[];
  totalOpen: number;
  groupChats: ReplyQueueInboxItem[];
  totalGroupChats: number;
  filteredOut: number;
  view: ReplyQueueInboxView;
  needsReplyCount: number;
  allInboundCount: number;
}

export async function getReplyQueueInbox(
  userId: string,
  view: ReplyQueueInboxView = "needs-reply",
): Promise<ReplyQueueInboxData> {
  const now = new Date();

  await prisma.inboxItem.updateMany({
    where: {
      userId,
      status: "SNOOZED",
      snoozeUntil: { lte: now },
    },
    data: {
      status: "OPEN",
      snoozeUntil: null,
    },
  });

  const [needsReplyCount, allOpenCount] = await Promise.all([
    prisma.inboxItem.count({
      where: {
        userId,
        status: "OPEN",
        OR: [{ needsResponse: null }, { needsResponse: true }],
      },
    }),
    prisma.inboxItem.count({
      where: { userId, status: "OPEN" },
    }),
  ]);
  const filteredOut = allOpenCount - needsReplyCount;

  const baseWhere = { userId, status: "OPEN" as const };
  const where =
    view === "all"
      ? baseWhere
      : {
          ...baseWhere,
          OR: [{ needsResponse: null }, { needsResponse: true }],
        };

  const [openItems, draftThreadIds] = await Promise.all([
    prisma.inboxItem.findMany({
      where,
      orderBy: { triggerAt: "desc" },
    }),
    getThreadsWithDrafts(userId),
  ]);

  const buildItem = (item: (typeof openItems)[number]): ReplyQueueInboxItem => {
    const hasDraft =
      item.channel === "email" &&
      item.threadKey.startsWith("gmail:") &&
      draftThreadIds.has(item.threadKey.slice(6));

    const priority = computePriority({
      tier: item.tier,
      channel: item.channel,
      triggerAt: item.triggerAt,
      messageCount: item.messageCount,
      isGroupChat: item.isGroupChat,
    });

    const messagePreview = Array.isArray(item.messagePreview)
      ? (item.messagePreview as ReplyQueueMessagePreview[])
      : [];

    const sourceRecordIds = Array.isArray(item.sourceRecordIds)
      ? (item.sourceRecordIds as unknown as string[])
      : [];

    return {
      id: item.id,
      contactId: item.contactId,
      contactName: item.contactName,
      company: item.company ?? null,
      tier: item.tier,
      channel: item.channel,
      threadKey: item.threadKey,
      isGroupChat: item.isGroupChat,
      contactEmail: item.contactEmail ?? null,
      contactPhone: item.contactPhone ?? null,
      contactLinkedinUrl: item.contactLinkedinUrl ?? null,
      triggerAt: item.triggerAt.toISOString(),
      lastInboundAt: item.triggerAt.toISOString(),
      messagePreview,
      messageCount: item.messageCount,
      status: item.status,
      hasDraft,
      priority: priority.priority,
      priorityScore: priority.score,
      priorityReason: priority.reason,
      sourceSystem: item.sourceSystem ?? null,
      sourceRecordIds,
      triggerInteractionId: item.triggerInteractionId,
      needsResponse: item.needsResponse,
      responseConfidence: item.responseConfidence,
      responseReason: item.responseReason,
      responseCategory: item.responseCategory,
      classifiedAt: item.classifiedAt ? item.classifiedAt.toISOString() : null,
    };
  };

  const oneToOne = openItems.filter((item) => !item.isGroupChat);
  const groups = openItems.filter((item) => item.isGroupChat);

  const items = oneToOne.map(buildItem);
  items.sort((a, b) => {
    if (a.hasDraft && !b.hasDraft) return 1;
    if (!a.hasDraft && b.hasDraft) return -1;
    return b.priorityScore - a.priorityScore;
  });

  const groupChats = groups
    .map(buildItem)
    .filter((group) => group.messagePreview.length > 0);
  groupChats.sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    items: items.slice(0, 50),
    totalOpen: items.length,
    groupChats: groupChats.slice(0, 50),
    totalGroupChats: groupChats.length,
    filteredOut,
    view,
    needsReplyCount,
    allInboundCount: allOpenCount,
  };
}
