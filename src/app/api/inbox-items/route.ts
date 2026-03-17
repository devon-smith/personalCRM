import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { isConversationEnder } from "@/lib/inbox";

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

// ─── Summary sanitization ───────────────────────────────────
// The attributedBody parser can concatenate multiple notification-stack
// messages into one summary separated by newlines (e.g. a real text +
// unrelated SMS notifications from short codes). Truncate at first newline.
function sanitizeSummary(summary: string | null): string | null {
  if (!summary) return summary;
  const newlineIdx = summary.indexOf("\n");
  if (newlineIdx === -1) return summary;
  return summary.slice(0, newlineIdx).trim() || summary;
}

// ─── Shared types ───────────────────────────────────────────

interface InboxRow {
  interactionId: string;
  chatId: string;
  contactId: string;
  direction: string;
  channel: string;
  summary: string | null;
  occurredAt: Date;
  isGroupChat: boolean;
  chatName: string | null;
  subject: string | null;
  needsReply: boolean | null;
  needsReplyReason: string | null;
  needsReplyConfidence: number | null;
}

interface PreviewMessage {
  summary: string;
  occurredAt: Date;
  channel: string | null;
}

/**
 * GET /api/inbox-items
 *
 * Computed inbox split into two sections:
 *   1. 1:1 conversations — auto-resolved by outbound detection, deduped by contactId
 *   2. Group chats — 7-day window, manual dismiss, auto-suppress if 2+ outbound in 24h
 *
 * Layer 2 content filters (applied at read time, not write time):
 *   A. Conversation-ender filter — checks FULL message batch, not just latest
 *   B. Outbound-after-tapback — catches false positives from tapback ordering
 *   C. Group-chat message exclusion from 1:1 — filters misattributed historical data
 *
 * Response: { items, totalOpen, groupChats, totalGroupChats }
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

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

    // ─── Phase 1: Parallel main queries ─────────────────────
    // Run 1:1, group, and dismissals queries concurrently
    const [oneToOneRows, groupRows, dismissals] = await Promise.all([
      // 1:1 Conversations — latest non-tapback message per chatId
      prisma.$queryRaw<InboxRow[]>`
        SELECT DISTINCT ON ("chatId")
          "id" as "interactionId",
          "chatId", "contactId", "direction", "channel", "summary",
          "occurredAt", "isGroupChat", "chatName", "subject",
          "needsReply", "needsReplyReason", "needsReplyConfidence"
        FROM "Interaction"
        WHERE "userId" = ${userId}
          AND "chatId" IS NOT NULL
          AND "isGroupChat" = false
          AND "dismissedAt" IS NULL
          AND "occurredAt" > ${thirtyDaysAgo}
          AND "type" != 'NOTE'
          AND "summary" NOT LIKE '(in group chat)%'
          AND "chatId" NOT LIKE '1:1:%'
          AND ("sourceId" IS NULL OR "sourceId" NOT LIKE 'manual-reply:%')
          AND ("sourceId" IS NULL OR "sourceId" NOT LIKE 'bulk-reply:%')
          AND (${Prisma.raw(TAPBACK_SQL)})
          ${selfExclusion}
        ORDER BY "chatId", "occurredAt" DESC
      `,
      // Group Chats — 7-day window
      prisma.$queryRaw<InboxRow[]>`
        SELECT DISTINCT ON ("chatId")
          "id" as "interactionId",
          "chatId", "contactId", "direction", "channel", "summary",
          "occurredAt", "isGroupChat", "chatName", "subject",
          "needsReply", "needsReplyReason", "needsReplyConfidence"
        FROM "Interaction"
        WHERE "userId" = ${userId}
          AND "chatId" IS NOT NULL
          AND "isGroupChat" = true
          AND "dismissedAt" IS NULL
          AND "occurredAt" > ${sevenDaysAgo}
          AND "type" != 'NOTE'
          AND "chatId" NOT LIKE '1:1:%'
          AND ("sourceId" IS NULL OR "sourceId" NOT LIKE 'manual-reply:%')
          AND ("sourceId" IS NULL OR "sourceId" NOT LIKE 'bulk-reply:%')
          AND (${Prisma.raw(TAPBACK_SQL)})
          ${selfExclusion}
        ORDER BY "chatId", "occurredAt" DESC
      `,
      // Dismissals
      prisma.inboxDismissal.findMany({
        where: { userId },
        select: { chatId: true, channel: true, snoozeUntil: true },
      }),
    ]);

    // Sanitize summaries — strip newline-concatenated notification bleed
    for (const r of oneToOneRows) { r.summary = sanitizeSummary(r.summary) ?? r.summary; }
    for (const r of groupRows) { r.summary = sanitizeSummary(r.summary) ?? r.summary; }

    // 1:1: filter to INBOUND, dedup by contactId
    const oneToOneNeedsReply = oneToOneRows.filter((r) => r.direction === "INBOUND");
    const contactDedup = new Map<string, InboxRow>();
    for (const r of oneToOneNeedsReply) {
      const existing = contactDedup.get(r.contactId);
      if (!existing || r.occurredAt > existing.occurredAt) {
        contactDedup.set(r.contactId, r);
      }
    }
    const dedupedOneToOne = [...contactDedup.values()];

    // Groups: filter to INBOUND
    const groupNeedsAttention = groupRows.filter((r) => r.direction === "INBOUND");

    // ─── Phase 2: Parallel secondary filters ─────────────────
    const oneToOneChatIds = dedupedOneToOne.map((r) => r.chatId);
    const groupChatIds = groupNeedsAttention.map((r) => r.chatId);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600000);

    const [outboundAfterInbound, outboundCounts] = await Promise.all([
      // Filter B: Outbound-after-tapback — catches false positives where
      // user replied, then someone tapback'd, exposing older inbound as "latest"
      oneToOneChatIds.length > 0
        ? prisma.$queryRaw<{ chatId: string }[]>`
            SELECT DISTINCT i."chatId"
            FROM "Interaction" i
            INNER JOIN (
              SELECT "chatId", "occurredAt" as inbound_at
              FROM unnest(${oneToOneChatIds}::text[]) WITH ORDINALITY t(cid, ord)
              INNER JOIN LATERAL (
                SELECT "chatId", "occurredAt"
                FROM "Interaction"
                WHERE "chatId" = t.cid AND "userId" = ${userId}
                  AND direction = 'INBOUND' AND "type" != 'NOTE'
                  AND "dismissedAt" IS NULL
                  AND "summary" NOT LIKE '(in group chat)%'
                  AND (${Prisma.raw(TAPBACK_SQL)})
                ORDER BY "occurredAt" DESC LIMIT 1
              ) sub ON true
            ) latest ON i."chatId" = latest."chatId"
            WHERE i."userId" = ${userId}
              AND i.direction = 'OUTBOUND'
              AND i."type" != 'NOTE'
              AND i."occurredAt" > latest.inbound_at
              AND (${Prisma.raw(TAPBACK_SQL)})
          `
        : Promise.resolve([]),
      // Auto-suppress groups: 2+ outbound in last 24h
      groupChatIds.length > 0
        ? prisma.$queryRaw<{ chatId: string; cnt: number }[]>`
            SELECT "chatId", COUNT(*)::int as cnt
            FROM "Interaction"
            WHERE "userId" = ${userId}
              AND "chatId" IN (${Prisma.join(groupChatIds)})
              AND direction = 'OUTBOUND'
              AND "occurredAt" > ${twentyFourHoursAgo}
              AND "type" != 'NOTE'
            GROUP BY "chatId"
            HAVING COUNT(*) >= 2
          `
        : Promise.resolve([]),
    ]);

    const resolvedByOutbound = new Set(outboundAfterInbound.map((r) => r.chatId));
    const afterTapbackFilter = dedupedOneToOne.filter(
      (r) => !resolvedByOutbound.has(r.chatId),
    );

    const suppressedChatIds = new Set(outboundCounts.map((r) => r.chatId));
    const activeGroups = groupNeedsAttention.filter((r) => !suppressedChatIds.has(r.chatId));

    const dismissalMap = new Map(
      dismissals.map((d) => [`${d.chatId}:${d.channel}`, d]),
    );

    const applyDismissals = (rows: InboxRow[]) =>
      rows.filter((r) => {
        const key = `${r.chatId}:${r.channel}`;
        const dismissal = dismissalMap.get(key);
        if (!dismissal) return true;
        if (!dismissal.snoozeUntil) return false;
        return dismissal.snoozeUntil <= new Date();
      });

    const filteredOneToOne = applyDismissals(afterTapbackFilter);
    const filteredGroups = applyDismissals(activeGroups);

    // ─── Phase 3: Parallel enrichment (contacts + previews) ──
    const allFiltered = [...filteredOneToOne, ...filteredGroups];
    const contactIds = [...new Set(allFiltered.map((r) => r.contactId))];
    const allChatIds = allFiltered.map((r) => r.chatId);

    interface PreviewRow {
      chatId: string;
      summary: string | null;
      occurredAt: Date;
      channel: string | null;
      direction: string;
    }

    const [contacts, allPreviews] = await Promise.all([
      contactIds.length > 0
        ? prisma.contact.findMany({
            where: { id: { in: contactIds } },
            select: {
              id: true, name: true, company: true, tier: true,
              email: true, phone: true, linkedinUrl: true,
            },
          })
        : Promise.resolve([]),
      allChatIds.length > 0
        ? prisma.$queryRaw<PreviewRow[]>`
            WITH chat_outbounds AS (
              SELECT "chatId", MAX("occurredAt") as last_outbound_at
              FROM "Interaction"
              WHERE "userId" = ${userId}
                AND "direction" = 'OUTBOUND'
                AND "type" != 'NOTE'
                AND "chatId" IN (${Prisma.join(allChatIds)})
              GROUP BY "chatId"
            ),
            numbered AS (
              SELECT i."chatId", i."summary", i."occurredAt", i."direction", i."channel",
                ROW_NUMBER() OVER (PARTITION BY i."chatId" ORDER BY i."occurredAt" DESC) as rn
              FROM "Interaction" i
              LEFT JOIN chat_outbounds co ON co."chatId" = i."chatId"
              WHERE i."userId" = ${userId}
                AND i."chatId" IN (${Prisma.join(allChatIds)})
                AND i."dismissedAt" IS NULL
                AND i."occurredAt" > COALESCE(co.last_outbound_at, '1970-01-01'::timestamp)
                AND i."type" != 'NOTE'
                AND (${Prisma.raw(TAPBACK_SQL)})
            )
            SELECT "chatId", "summary", "occurredAt", "direction", "channel"
            FROM numbered WHERE rn <= 10
            ORDER BY "chatId", "occurredAt" DESC
          `
        : Promise.resolve([]),
    ]);

    const contactMap = new Map(contacts.map((c) => [c.id, c]));

    // Track which chatIds are 1:1 vs group for preview filtering
    const oneToOneChatIdSet = new Set(filteredOneToOne.map((r) => r.chatId));

    // Group previews by chatId, filter tapbacks in code, deduplicate.
    // For 1:1 chats, ALSO exclude messages with "(in group chat)" prefix —
    // these are historical misattributions from old sync.
    const previewsByChat = new Map<string, PreviewMessage[]>();

    for (const p of allPreviews) {
      if (!p.chatId || p.direction !== "INBOUND") continue;
      if (isTapback(p.summary ?? "")) continue;

      // For 1:1 chats, filter out misattributed group chat messages
      const isOneToOne = oneToOneChatIdSet.has(p.chatId);
      if (isOneToOne && (p.summary ?? "").startsWith("(in group chat)")) continue;

      const list = previewsByChat.get(p.chatId) ?? [];
      previewsByChat.set(p.chatId, list);

      const sec = Math.floor(p.occurredAt.getTime() / 1000);
      const isDupe = list.some((existing) =>
        existing.summary === (p.summary ?? "") &&
        Math.floor(existing.occurredAt.getTime() / 1000) === sec,
      );
      if (isDupe) continue;

      if (list.length < 10) {
        list.push({
          summary: sanitizeSummary(p.summary) ?? p.summary ?? "",
          occurredAt: p.occurredAt,
          channel: p.channel,
        });
      }
    }

    // ─── Filters disabled — show all unresponded conversations ──
    // Previously filtered by conversation enders and AI classification,
    // but this was too aggressive. Let the user decide what to dismiss.
    const afterAiFilter = filteredOneToOne;
    const filteredGroupsAfterAi = filteredGroups;

    // ─── Phase 5: Group chat names + dedup (parallel where possible) ──
    const groupChatIds_all = allFiltered.filter((r) => r.isGroupChat).map((r) => r.chatId);
    const groupChatNames = new Map<string, string>();
    const allGroupChatIdsForDedup = filteredGroupsAfterAi.map((r) => r.chatId);

    const isRealChatName = (name: string | null): boolean => {
      if (!name) return false;
      if (name.startsWith("gc:") || name.startsWith("imsg-")) return false;
      if (name === "Group message" || name.endsWith(" message")) return false;
      return true;
    };

    // Check chatName from the DISTINCT ON rows first (in-memory, no DB)
    for (const r of allFiltered) {
      if (!r.isGroupChat) continue;
      if (isRealChatName(r.chatName)) {
        groupChatNames.set(r.chatId, r.chatName!);
      }
    }

    // Combine all group chatIds needing participant data (naming + dedup)
    const unnamed = groupChatIds_all.filter((id) => !groupChatNames.has(id));
    const allGroupIdsNeedingParticipants = [...new Set([...unnamed, ...allGroupChatIdsForDedup])];

    // Run chat name DB lookup + combined participant query in parallel
    const [chatNameRows, allParticipantRows] = await Promise.all([
      unnamed.length > 0
        ? prisma.interaction.findMany({
            where: { chatId: { in: unnamed }, chatName: { not: null } },
            select: { chatId: true, chatName: true },
            distinct: ["chatId"],
          })
        : Promise.resolve([]),
      allGroupIdsNeedingParticipants.length > 0
        ? prisma.$queryRaw<{ chatId: string; contactId: string }[]>`
            SELECT DISTINCT "chatId", "contactId"
            FROM "Interaction"
            WHERE "chatId" IN (${Prisma.join(allGroupIdsNeedingParticipants)})
              AND "userId" = ${userId}
          `
        : Promise.resolve([]),
    ]);

    // Apply DB chat names
    for (const row of chatNameRows) {
      if (row.chatId && isRealChatName(row.chatName)) {
        groupChatNames.set(row.chatId, row.chatName!);
      }
    }

    // Build participant map (shared by naming + dedup)
    const participantsByChatId = new Map<string, Set<string>>();
    for (const row of allParticipantRows) {
      const set = participantsByChatId.get(row.chatId) ?? new Set();
      set.add(row.contactId);
      participantsByChatId.set(row.chatId, set);
    }

    // Resolve unnamed chats from participant names
    const stillUnnamed = unnamed.filter((id) => !groupChatNames.has(id));
    if (stillUnnamed.length > 0) {
      const allParticipantIds = [...new Set(allParticipantRows.map((r) => r.contactId))];
      const participantContacts = allParticipantIds.length > 0
        ? await prisma.contact.findMany({
            where: { id: { in: allParticipantIds } },
            select: { id: true, name: true },
          })
        : [];
      const participantNameMap = new Map(participantContacts.map((c) => [c.id, c.name]));

      const selfIdSet = new Set(selfContactIds);
      for (const chatId of stillUnnamed) {
        const contactIdSet = participantsByChatId.get(chatId);
        if (!contactIdSet) continue;

        const names = [...contactIdSet]
          .filter((id) => !selfIdSet.has(id))
          .map((id) => participantNameMap.get(id))
          .filter((n): n is string => !!n)
          .map((n) => n.split(" ")[0]);

        if (names.length === 0) continue;
        if (names.length <= 3) {
          groupChatNames.set(chatId, names.join(", "));
        } else {
          groupChatNames.set(chatId, `${names.slice(0, 2).join(", ")} + ${names.length - 2} others`);
        }
      }
    }

    // ─── Group chat dedup (uses shared participant data) ─────
    const dedupParticipants = participantsByChatId;

    // Build set of contactIds that appear in multi-participant chats
    const contactsInMultiParticipant = new Set<string>();
    for (const [, participants] of dedupParticipants) {
      if (participants.size > 1) {
        for (const cid of participants) contactsInMultiParticipant.add(cid);
      }
    }

    // Filter: drop single-participant group chats whose participant is in a bigger chat
    const dedupedGroups = filteredGroupsAfterAi.filter((r) => {
      const participants = dedupParticipants.get(r.chatId);
      if (!participants || participants.size > 1) return true; // multi-participant → keep
      const [soleParticipant] = participants;
      return !contactsInMultiParticipant.has(soleParticipant);
    });

    // ─── Build response items ────────────────────────────────
    const buildItem = (r: InboxRow) => {
      const contact = contactMap.get(r.contactId);
      const chatPreviews = previewsByChat.get(r.chatId) ?? [];
      const latestInbound = chatPreviews[0];

      let displayName: string;
      if (r.isGroupChat) {
        displayName = groupChatNames.get(r.chatId)
          ?? r.subject
          ?? "Group Chat";
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
        needsReplyReason: r.needsReplyReason,
      };
    };

    const items = afterAiFilter.map(buildItem);
    items.sort((a, b) =>
      new Date(b.triggerAt).getTime() - new Date(a.triggerAt).getTime(),
    );

    const groupChats = dedupedGroups.map(buildItem)
      .filter((g) => g.messagePreview.length > 0); // Drop tapback-only entries with no previews
    groupChats.sort((a, b) =>
      new Date(b.triggerAt).getTime() - new Date(a.triggerAt).getTime(),
    );

    return NextResponse.json({
      items: items.slice(0, 50),
      totalOpen: items.length,
      groupChats: groupChats.slice(0, 50),
      totalGroupChats: groupChats.length,
    });
  } catch (error) {
    console.error("[GET /api/inbox-items]", error);
    return NextResponse.json(
      { error: "Failed to fetch inbox" },
      { status: 500 },
    );
  }
}
