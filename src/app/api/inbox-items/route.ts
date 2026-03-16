import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

// ─── Tapback detection ──────────────────────────────────────

const TAPBACK_VERBS = ["Loved", "Liked", "Laughed at", "Emphasized", "Disliked", "Questioned"];

function isTapback(summary: string): boolean {
  if (!summary) return false;
  const s = summary.replace(/^\(in group chat\)\s*/i, "").trim();
  for (const verb of TAPBACK_VERBS) {
    if (s.startsWith(`${verb} \u201C`) || s.startsWith(`${verb} "`)) return true;
    if (new RegExp(`^${verb}\\s+(a |an )`, "i").test(s)) return true;
  }
  if (/^Reacted\s+.+\s+to\s+/i.test(s)) return true;
  return false;
}

// Build SQL exclusions for tapbacks
const TAPBACK_SQL_PATTERNS = [
  ...TAPBACK_VERBS.flatMap((v) => [
    `${v} \u201C`,
    `${v} "`,
    `${v} a `,
    `${v} an `,
  ]),
  "(in group chat) Loved",
  "(in group chat) Liked",
  "(in group chat) Laughed at",
  "(in group chat) Emphasized",
  "(in group chat) Disliked",
  "(in group chat) Questioned",
  "Reacted ",
];

const TAPBACK_SQL = TAPBACK_SQL_PATTERNS
  .map((p) => `"summary" NOT LIKE '${p.replace(/'/g, "''")}%'`)
  .join(" AND ");

/**
 * GET /api/inbox-items
 *
 * Computed inbox: "conversations where the last non-reaction message is INBOUND"
 *
 * No stored state — derived from Interaction table + InboxDismissal.
 * Each chatId gets one inbox entry. Group chats show as one item.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    // Find self-contact IDs to exclude
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    const selfContactIds: string[] = [];
    if (user?.email || user?.name) {
      const selfContacts = await prisma.contact.findMany({
        where: {
          userId,
          OR: [
            ...(user.email ? [{ email: user.email }] : []),
            ...(user.name ? [{ name: user.name }] : []),
          ],
        },
        select: { id: true },
      });
      selfContactIds.push(...selfContacts.map((c) => c.id));
    }

    const selfExclusion = selfContactIds.length > 0
      ? Prisma.sql`AND "contactId" NOT IN (${Prisma.join(selfContactIds)})`
      : Prisma.empty;

    // Core query: for each chatId, find the latest non-reaction message.
    // If it's INBOUND → needs reply. If OUTBOUND → already replied.
    interface InboxRow {
      chatId: string;
      contactId: string;
      direction: string;
      channel: string;
      summary: string | null;
      occurredAt: Date;
      isGroupChat: boolean;
      chatName: string | null;
      subject: string | null;
    }

    const inboxRows = await prisma.$queryRaw<InboxRow[]>`
      SELECT DISTINCT ON ("chatId")
        "chatId",
        "contactId",
        "direction",
        "channel",
        "summary",
        "occurredAt",
        "isGroupChat",
        "chatName",
        "subject"
      FROM "Interaction"
      WHERE "userId" = ${userId}
        AND "chatId" IS NOT NULL
        AND "dismissedAt" IS NULL
        AND "occurredAt" > ${thirtyDaysAgo}
        AND "type" != 'NOTE'
        AND (${Prisma.raw(TAPBACK_SQL)})
        ${selfExclusion}
      ORDER BY "chatId", "occurredAt" DESC
    `;

    // Filter to only INBOUND latest messages (conversations needing reply)
    const needsReply = inboxRows.filter((r) => r.direction === "INBOUND");

    // Exclude dismissed/snoozed conversations
    const dismissals = await prisma.inboxDismissal.findMany({
      where: { userId },
      select: { chatId: true, channel: true, snoozeUntil: true },
    });
    const dismissalMap = new Map(
      dismissals.map((d) => [`${d.chatId}:${d.channel}`, d]),
    );

    const filtered = needsReply.filter((r) => {
      const key = `${r.chatId}:${r.channel}`;
      const dismissal = dismissalMap.get(key);
      if (!dismissal) return true;
      if (!dismissal.snoozeUntil) return false;
      return dismissal.snoozeUntil <= new Date();
    });

    // Fetch contact info for all items
    const contactIds = [...new Set(filtered.map((r) => r.contactId))];
    const contacts = contactIds.length > 0
      ? await prisma.contact.findMany({
          where: { id: { in: contactIds } },
          select: {
            id: true, name: true, company: true, tier: true,
            email: true, phone: true, linkedinUrl: true,
          },
        })
      : [];
    const contactMap = new Map(contacts.map((c) => [c.id, c]));

    // Fetch message previews for all chats (batch, not N+1)
    // Include both INBOUND and OUTBOUND for context, exclude tapbacks and NOTEs
    const chatIds = filtered.map((r) => r.chatId);
    const allPreviews = chatIds.length > 0
      ? await prisma.interaction.findMany({
          where: {
            userId,
            chatId: { in: chatIds },
            occurredAt: { gt: thirtyDaysAgo },
            type: { not: "NOTE" },
            dismissedAt: null,
          },
          select: {
            chatId: true,
            summary: true,
            occurredAt: true,
            channel: true,
            direction: true,
          },
          orderBy: { occurredAt: "desc" },
        })
      : [];

    // Group previews by chatId, filter tapbacks, deduplicate, take 10 inbound
    const previewsByChat = new Map<string, Array<{
      summary: string;
      occurredAt: Date;
      channel: string | null;
    }>>();

    for (const p of allPreviews) {
      if (!p.chatId || p.direction !== "INBOUND") continue;
      if (isTapback(p.summary ?? "")) continue;

      const list = previewsByChat.get(p.chatId) ?? [];
      previewsByChat.set(p.chatId, list);

      // Deduplicate: skip if same summary + same second
      const sec = Math.floor(p.occurredAt.getTime() / 1000);
      const isDupe = list.some((existing) =>
        existing.summary === (p.summary ?? "") &&
        Math.floor(existing.occurredAt.getTime() / 1000) === sec,
      );
      if (isDupe) continue;

      if (list.length < 10) {
        list.push({
          summary: p.summary ?? "",
          occurredAt: p.occurredAt,
          channel: p.channel,
        });
      }
    }

    // For group chats, resolve display name from chatName or latest Interaction
    // Look up the best chatName from any interaction in that chat
    const groupChatNames = new Map<string, string>();
    for (const r of filtered) {
      if (!r.isGroupChat) continue;
      if (r.chatName && !r.chatName.startsWith("gc:") && !r.chatName.startsWith("imsg-")) {
        groupChatNames.set(r.chatId, r.chatName);
      }
    }
    // If we still don't have names, query for them
    const unnamed = filtered.filter(
      (r) => r.isGroupChat && !groupChatNames.has(r.chatId),
    );
    if (unnamed.length > 0) {
      const chatNameRows = await prisma.interaction.findMany({
        where: {
          chatId: { in: unnamed.map((r) => r.chatId) },
          chatName: { not: null },
        },
        select: { chatId: true, chatName: true },
        distinct: ["chatId"],
      });
      for (const row of chatNameRows) {
        if (row.chatId && row.chatName && !row.chatName.startsWith("gc:") && !row.chatName.startsWith("imsg-")) {
          groupChatNames.set(row.chatId, row.chatName);
        }
      }
    }

    // Build response
    const items = filtered.map((r) => {
      const contact = contactMap.get(r.contactId);
      const chatPreviews = previewsByChat.get(r.chatId) ?? [];
      const latestInbound = chatPreviews[0];

      // Resolve display name
      let displayName: string;
      if (r.isGroupChat) {
        displayName = groupChatNames.get(r.chatId)
          ?? r.subject
          ?? "Group Chat";
        // Clean up any technical prefixes
        if (displayName.startsWith("gc:") || displayName.startsWith("imsg-") || displayName === "Group message" || displayName.endsWith(" message")) {
          displayName = contact?.name
            ? `${contact.name} + group`
            : "Group Chat";
        }
      } else {
        displayName = contact?.name ?? "Unknown";
      }

      return {
        id: r.chatId,
        contactId: r.contactId,
        contactName: displayName,
        company: r.isGroupChat ? null : (contact?.company ?? null),
        tier: contact?.tier ?? "general",
        channel: r.channel ?? "text",
        threadKey: r.chatId,
        isGroupChat: r.isGroupChat,
        contactEmail: contact?.email ?? null,
        contactPhone: contact?.phone ?? null,
        contactLinkedinUrl: contact?.linkedinUrl ?? null,
        triggerAt: (latestInbound?.occurredAt ?? r.occurredAt).toISOString(),
        lastInboundAt: (latestInbound?.occurredAt ?? r.occurredAt).toISOString(),
        messagePreview: chatPreviews.map((p) => ({
          summary: p.summary,
          occurredAt: p.occurredAt.toISOString(),
          channel: p.channel ?? "text",
        })),
        messageCount: chatPreviews.length,
        status: "OPEN",
      };
    });

    // Sort newest first
    items.sort((a, b) =>
      new Date(b.triggerAt).getTime() - new Date(a.triggerAt).getTime(),
    );

    return NextResponse.json({
      items: items.slice(0, 50),
      totalOpen: items.length,
    });
  } catch (error) {
    console.error("[GET /api/inbox-items]", error);
    return NextResponse.json(
      { error: "Failed to fetch inbox" },
      { status: 500 },
    );
  }
}
