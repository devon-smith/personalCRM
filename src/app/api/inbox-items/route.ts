import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { isTapback, TAPBACK_SQL, sanitizeSummary } from "@/lib/filters";

// ─── In-memory cache (short TTL to avoid redundant queries) ──

interface CachedResponse {
  readonly data: string;
  readonly expiresAt: number;
}
let inboxCache: CachedResponse | null = null;
const CACHE_TTL_MS = 3000; // 3 seconds

/** Invalidate the inbox cache (call after resolve, dismiss, sync, etc.) */
export function invalidateInboxCache() {
  inboxCache = null;
}

// ─── Types ───────────────────────────────────────────────────

interface ThreadInboxRow {
  threadId: string;
  source: string;
  isGroup: boolean;
  displayName: string | null;
  interactionId: string;
  contactId: string;
  direction: string;
  channel: string;
  summary: string | null;
  occurredAt: Date;
  subject: string | null;
  needsReplyReason: string | null;
  chatId: string | null;
}

interface PreviewMessage {
  summary: string;
  occurredAt: Date;
  channel: string | null;
}

/**
 * GET /api/inbox-items
 *
 * Thread-based unified inbox. Uses the Thread model as the primary axis:
 * - For each thread, finds the latest non-tapback interaction
 * - If that interaction is INBOUND and no OUTBOUND exists after it → needs reply
 * - Split into 1:1 (30-day window) and group chats (7-day window)
 *
 * Response: { items, totalOpen, groupChats, totalGroupChats }
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (inboxCache && Date.now() < inboxCache.expiresAt) {
      return new NextResponse(inboxCache.data, {
        headers: { "content-type": "application/json" },
      });
    }

    const userId = session.user.id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

    // Check if Thread data exists; fall back to legacy query if not
    const threadCount = await prisma.thread.count({ where: { userId } });
    if (threadCount === 0) {
      return legacyInboxQuery(userId, thirtyDaysAgo, sevenDaysAgo);
    }

    // ─── Self-contact exclusion subquery ─────────────────────
    const selfExclusion = Prisma.sql`AND latest."contactId" NOT IN (
      SELECT c.id FROM "Contact" c
      JOIN "User" u ON u.id = ${userId}
      WHERE c."userId" = ${userId}
        AND (c.email = u.email OR c.name = u.name)
    )`;

    // ─── Main query: threads needing reply ───────────────────
    // Uses JOIN LATERAL to get latest non-noise interaction per thread,
    // then excludes threads where an outbound exists after that inbound.
    const [oneToOneRows, groupRows, dismissals] = await Promise.all([
      // 1:1 threads — 30-day window
      prisma.$queryRaw<ThreadInboxRow[]>`
        SELECT
          t.id as "threadId", t.source, t."isGroup", t."displayName",
          latest.id as "interactionId", latest."contactId", latest.direction,
          latest.channel, latest.summary, latest."occurredAt", latest.subject,
          latest."needsReplyReason", latest."chatId"
        FROM "Thread" t
        JOIN LATERAL (
          SELECT * FROM "Interaction"
          WHERE "threadId" = t.id
            AND "dismissedAt" IS NULL
            AND "type" != 'NOTE'
            AND ("sourceId" IS NULL OR "sourceId" NOT LIKE 'manual-reply:%')
            AND ("sourceId" IS NULL OR "sourceId" NOT LIKE 'bulk-reply:%')
            AND (${Prisma.raw(TAPBACK_SQL)})
          ORDER BY "occurredAt" DESC
          LIMIT 1
        ) latest ON true
        WHERE t."userId" = ${userId}
          AND t."isGroup" = false
          AND t."lastActivityAt" > ${thirtyDaysAgo}
          AND latest.direction = 'INBOUND'
          AND NOT EXISTS (
            SELECT 1 FROM "Interaction"
            WHERE "threadId" = t.id
              AND direction = 'OUTBOUND'
              AND "type" != 'NOTE'
              AND "occurredAt" > latest."occurredAt"
          )
          ${selfExclusion}
        ORDER BY latest."occurredAt" DESC
      `,
      // Group threads — 7-day window
      prisma.$queryRaw<ThreadInboxRow[]>`
        SELECT
          t.id as "threadId", t.source, t."isGroup", t."displayName",
          latest.id as "interactionId", latest."contactId", latest.direction,
          latest.channel, latest.summary, latest."occurredAt", latest.subject,
          latest."needsReplyReason", latest."chatId"
        FROM "Thread" t
        JOIN LATERAL (
          SELECT * FROM "Interaction"
          WHERE "threadId" = t.id
            AND "dismissedAt" IS NULL
            AND "type" != 'NOTE'
            AND ("sourceId" IS NULL OR "sourceId" NOT LIKE 'manual-reply:%')
            AND ("sourceId" IS NULL OR "sourceId" NOT LIKE 'bulk-reply:%')
            AND (${Prisma.raw(TAPBACK_SQL)})
          ORDER BY "occurredAt" DESC
          LIMIT 1
        ) latest ON true
        WHERE t."userId" = ${userId}
          AND t."isGroup" = true
          AND t."lastActivityAt" > ${sevenDaysAgo}
          AND latest.direction = 'INBOUND'
          AND NOT EXISTS (
            SELECT 1 FROM "Interaction"
            WHERE "threadId" = t.id
              AND direction = 'OUTBOUND'
              AND "type" != 'NOTE'
              AND "occurredAt" > latest."occurredAt"
          )
          ${selfExclusion}
        ORDER BY latest."occurredAt" DESC
      `,
      // Dismissals
      prisma.inboxDismissal.findMany({
        where: { userId },
        select: { chatId: true, channel: true, snoozeUntil: true },
      }),
    ]);

    // Sanitize summaries
    for (const r of oneToOneRows) { r.summary = sanitizeSummary(r.summary) ?? r.summary; }
    for (const r of groupRows) { r.summary = sanitizeSummary(r.summary) ?? r.summary; }

    // Dedup 1:1 by contactId (multiple threads for same contact)
    const contactDedup = new Map<string, ThreadInboxRow>();
    for (const r of oneToOneRows) {
      const existing = contactDedup.get(r.contactId);
      if (!existing || r.occurredAt > existing.occurredAt) {
        contactDedup.set(r.contactId, r);
      }
    }
    const dedupedOneToOne = [...contactDedup.values()];

    // Apply dismissals
    const dismissalMap = new Map(
      dismissals.map((d) => [`${d.chatId}:${d.channel}`, d]),
    );
    const applyDismissals = <T extends { chatId: string | null; channel: string }>(rows: T[]) =>
      rows.filter((r) => {
        if (!r.chatId) return true;
        const key = `${r.chatId}:${r.channel}`;
        const dismissal = dismissalMap.get(key);
        if (!dismissal) return true;
        if (!dismissal.snoozeUntil) return false;
        return dismissal.snoozeUntil <= new Date();
      });

    const filteredOneToOne = applyDismissals(dedupedOneToOne);
    const filteredGroups = applyDismissals(groupRows);

    // ─── Enrichment: contacts + previews ─────────────────────
    const allFiltered = [...filteredOneToOne, ...filteredGroups];
    const contactIds = [...new Set(allFiltered.map((r) => r.contactId))];
    const threadIds = allFiltered.map((r) => r.threadId);

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
      threadIds.length > 0
        ? prisma.$queryRaw<{
            threadId: string;
            summary: string | null;
            occurredAt: Date;
            channel: string | null;
            direction: string;
          }[]>`
            WITH thread_outbounds AS (
              SELECT "threadId", MAX("occurredAt") as last_outbound_at
              FROM "Interaction"
              WHERE "userId" = ${userId}
                AND "direction" = 'OUTBOUND'
                AND "type" != 'NOTE'
                AND "threadId" IN (${Prisma.join(threadIds)})
              GROUP BY "threadId"
            ),
            numbered AS (
              SELECT i."threadId", i.summary, i."occurredAt", i.direction, i.channel,
                ROW_NUMBER() OVER (PARTITION BY i."threadId" ORDER BY i."occurredAt" DESC) as rn
              FROM "Interaction" i
              LEFT JOIN thread_outbounds o ON o."threadId" = i."threadId"
              WHERE i."userId" = ${userId}
                AND i."threadId" IN (${Prisma.join(threadIds)})
                AND i."dismissedAt" IS NULL
                AND i."occurredAt" > COALESCE(o.last_outbound_at, '1970-01-01'::timestamp)
                AND i."type" != 'NOTE'
                AND (${Prisma.raw(TAPBACK_SQL)})
            )
            SELECT "threadId", summary, "occurredAt", direction, channel
            FROM numbered WHERE rn <= 10
            ORDER BY "threadId", "occurredAt" DESC
          `
        : Promise.resolve([]),
    ]);

    const contactMap = new Map(contacts.map((c) => [c.id, c]));

    // Build previews by threadId
    const previewsByThread = new Map<string, PreviewMessage[]>();
    for (const p of allPreviews) {
      if (!p.threadId || p.direction !== "INBOUND") continue;
      if (isTapback(p.summary ?? "")) continue;

      const list = previewsByThread.get(p.threadId) ?? [];
      previewsByThread.set(p.threadId, list);

      // Deduplicate by summary + second-precision timestamp
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

    // ─── Build response items ────────────────────────────────
    const buildItem = (r: ThreadInboxRow) => {
      const contact = contactMap.get(r.contactId);
      const previews = previewsByThread.get(r.threadId) ?? [];
      const latestInbound = previews[0];

      const displayName = r.isGroup
        ? (r.displayName ?? r.subject ?? "Group Chat")
        : (contact?.name ?? "Unknown");

      return {
        id: r.chatId ?? r.threadId,
        contactId: r.contactId,
        contactName: displayName,
        company: r.isGroup ? null : (contact?.company ?? null),
        tier: contact?.tier ?? "general",
        channel: r.channel ?? "text",
        threadKey: r.chatId ?? r.threadId,
        isGroupChat: r.isGroup,
        contactEmail: contact?.email ?? null,
        contactPhone: contact?.phone ?? null,
        contactLinkedinUrl: contact?.linkedinUrl ?? null,
        triggerAt: (latestInbound?.occurredAt ?? r.occurredAt).toISOString(),
        lastInboundAt: (latestInbound?.occurredAt ?? r.occurredAt).toISOString(),
        messagePreview: previews.map((p) => ({
          summary: p.summary,
          occurredAt: p.occurredAt.toISOString(),
          channel: p.channel ?? "text",
        })),
        messageCount: previews.length,
        status: "OPEN",
        needsReplyReason: r.needsReplyReason,
      };
    };

    const items = filteredOneToOne.map(buildItem);
    items.sort((a, b) =>
      new Date(b.triggerAt).getTime() - new Date(a.triggerAt).getTime(),
    );

    const groupChats = filteredGroups.map(buildItem)
      .filter((g) => g.messagePreview.length > 0);
    groupChats.sort((a, b) =>
      new Date(b.triggerAt).getTime() - new Date(a.triggerAt).getTime(),
    );

    const responseBody = JSON.stringify({
      items: items.slice(0, 50),
      totalOpen: items.length,
      groupChats: groupChats.slice(0, 50),
      totalGroupChats: groupChats.length,
    });

    inboxCache = { data: responseBody, expiresAt: Date.now() + CACHE_TTL_MS };

    return new NextResponse(responseBody, {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    console.error("[GET /api/inbox-items]", error);
    return NextResponse.json(
      { error: "Failed to fetch inbox" },
      { status: 500 },
    );
  }
}

// ─── Legacy query (used when Thread table is empty) ──────────
// This is the original 5-phase DISTINCT ON (chatId) approach.
// Kept as fallback until backfill is run.

async function legacyInboxQuery(
  userId: string,
  thirtyDaysAgo: Date,
  sevenDaysAgo: Date,
): Promise<NextResponse> {
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
    needsReplyReason: string | null;
  }

  const selfExclusion = Prisma.sql`AND "contactId" NOT IN (
    SELECT c.id FROM "Contact" c
    JOIN "User" u ON u.id = ${userId}
    WHERE c."userId" = ${userId}
      AND (c.email = u.email OR c.name = u.name)
  )`;

  const [oneToOneRows, groupRows, dismissals] = await Promise.all([
    prisma.$queryRaw<InboxRow[]>`
      SELECT DISTINCT ON ("chatId")
        "id" as "interactionId",
        "chatId", "contactId", "direction", "channel", "summary",
        "occurredAt", "isGroupChat", "chatName", "subject",
        "needsReplyReason"
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
    prisma.$queryRaw<InboxRow[]>`
      SELECT DISTINCT ON ("chatId")
        "id" as "interactionId",
        "chatId", "contactId", "direction", "channel", "summary",
        "occurredAt", "isGroupChat", "chatName", "subject",
        "needsReplyReason"
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
    prisma.inboxDismissal.findMany({
      where: { userId },
      select: { chatId: true, channel: true, snoozeUntil: true },
    }),
  ]);

  for (const r of oneToOneRows) { r.summary = sanitizeSummary(r.summary) ?? r.summary; }
  for (const r of groupRows) { r.summary = sanitizeSummary(r.summary) ?? r.summary; }

  const oneToOneNeedsReply = oneToOneRows.filter((r) => r.direction === "INBOUND");
  const contactDedup = new Map<string, InboxRow>();
  for (const r of oneToOneNeedsReply) {
    const existing = contactDedup.get(r.contactId);
    if (!existing || r.occurredAt > existing.occurredAt) {
      contactDedup.set(r.contactId, r);
    }
  }
  const dedupedOneToOne = [...contactDedup.values()];
  const groupNeedsAttention = groupRows.filter((r) => r.direction === "INBOUND");

  // Outbound-after-inbound check
  const chatInboundPairs = dedupedOneToOne.map((r) => ({
    chatId: r.chatId,
    inboundAt: r.occurredAt,
  }));
  const oneToOneChatIds = dedupedOneToOne.map((r) => r.chatId);

  const outboundAfterInbound = oneToOneChatIds.length > 0
    ? await prisma.$queryRaw<{ chatId: string }[]>`
        SELECT DISTINCT i."chatId"
        FROM "Interaction" i
        INNER JOIN (
          SELECT unnest(${chatInboundPairs.map((p) => p.chatId)}::text[]) as "chatId",
                 unnest(${chatInboundPairs.map((p) => p.inboundAt)}::timestamptz[]) as inbound_at
        ) latest ON i."chatId" = latest."chatId"
        WHERE i."userId" = ${userId}
          AND i.direction = 'OUTBOUND'
          AND i."type" != 'NOTE'
          AND i."occurredAt" > latest.inbound_at
      `
    : [];

  const resolvedByOutbound = new Set(outboundAfterInbound.map((r) => r.chatId));
  const afterOutboundFilter = dedupedOneToOne.filter((r) => !resolvedByOutbound.has(r.chatId));

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

  const filteredOneToOne = applyDismissals(afterOutboundFilter);
  const filteredGroups = applyDismissals(groupNeedsAttention);

  // Enrichment
  const allFiltered = [...filteredOneToOne, ...filteredGroups];
  const contactIds = [...new Set(allFiltered.map((r) => r.contactId))];

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

  const buildItem = (r: InboxRow) => {
    const contact = contactMap.get(r.contactId);
    return {
      id: r.chatId,
      contactId: r.contactId,
      contactName: r.isGroupChat
        ? (r.chatName ?? r.subject ?? "Group Chat")
        : (contact?.name ?? "Unknown"),
      company: r.isGroupChat ? null : (contact?.company ?? null),
      tier: contact?.tier ?? "general",
      channel: r.channel ?? "text",
      threadKey: r.chatId,
      isGroupChat: r.isGroupChat,
      contactEmail: contact?.email ?? null,
      contactPhone: contact?.phone ?? null,
      contactLinkedinUrl: contact?.linkedinUrl ?? null,
      triggerAt: r.occurredAt.toISOString(),
      lastInboundAt: r.occurredAt.toISOString(),
      messagePreview: [],
      messageCount: 0,
      status: "OPEN",
      needsReplyReason: r.needsReplyReason,
    };
  };

  const items = filteredOneToOne.map(buildItem);
  items.sort((a, b) => new Date(b.triggerAt).getTime() - new Date(a.triggerAt).getTime());

  const groupChats = filteredGroups.map(buildItem);
  groupChats.sort((a, b) => new Date(b.triggerAt).getTime() - new Date(a.triggerAt).getTime());

  const responseBody = JSON.stringify({
    items: items.slice(0, 50),
    totalOpen: items.length,
    groupChats: groupChats.slice(0, 50),
    totalGroupChats: groupChats.length,
  });

  inboxCache = { data: responseBody, expiresAt: Date.now() + CACHE_TTL_MS };

  return new NextResponse(responseBody, {
    headers: { "content-type": "application/json" },
  });
}
