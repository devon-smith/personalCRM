import { prisma } from "@/lib/prisma";
import { autoResolveOnOutbound } from "@/lib/auto-resolve";

// ─── Types ───────────────────────────────────────────────────

export interface UnmatchedHandle {
  readonly handle: string;
  readonly type: "email" | "phone";
  readonly messageCount: number;
  readonly lastPreview: string;
  readonly lastTimestamp: string;
  readonly isGroupChat: boolean;
}

export interface NotionMessageSyncResult {
  readonly processed: number;
  readonly matched: number;
  readonly unmatched: number;
  readonly alreadySynced: number;
  readonly errors: number;
  readonly unmatchedHandles: readonly UnmatchedHandle[];
}

interface NotionBlock {
  readonly id: string;
  readonly type: string;
  readonly paragraph?: {
    readonly rich_text: ReadonlyArray<{ readonly plain_text: string }>;
  };
  readonly created_time: string;
}

interface ParsedMessage {
  readonly sender: string;
  readonly body: string;
  readonly recipients: readonly string[];
  readonly isGroupChat: boolean;
  readonly blockIds: readonly string[];
  readonly timestamp: string;
}

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VER = "2022-06-28";

// ─── Notion API helpers ─────────────────────────────────────

async function notionFetch(path: string, token: string) {
  const res = await fetch(`${NOTION_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VER,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Notion ${res.status}: ${JSON.stringify(err)}`);
  }
  return res.json();
}

async function fetchAllBlocks(
  pageId: string,
  token: string,
): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;

  do {
    const params = cursor
      ? `?start_cursor=${cursor}&page_size=100`
      : "?page_size=100";
    const data = await notionFetch(
      `/blocks/${pageId}/children${params}`,
      token,
    );
    for (const block of data.results) {
      if (
        block.type === "paragraph" &&
        block.paragraph?.rich_text?.length > 0
      ) {
        blocks.push(block);
      }
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return blocks;
}

// ─── Block text extraction ──────────────────────────────────

function getBlockText(block: NotionBlock): string {
  return (
    block.paragraph?.rich_text
      .map((t: { plain_text: string }) => t.plain_text)
      .join("") || ""
  );
}

// ─── Handle detection ───────────────────────────────────────

function looksLikeHandle(text: string): boolean {
  const t = text.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return true;
  if (/^\+?[\d\s\-()]{7,20}$/.test(t)) return true;
  // Multiple handles separated by spaces or newlines (group chat recipients)
  const parts = t.split(/[\s\n]+/).filter(Boolean);
  if (
    parts.length > 1 &&
    parts.every(
      (p) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p) ||
        /^\+?[\d\-()]{7,20}$/.test(p),
    )
  )
    return true;
  return false;
}

/** Extract all handles from a block that may contain newline-separated handles */
function extractHandles(text: string): string[] {
  return text
    .trim()
    .split(/[\s\n]+/)
    .filter(Boolean);
}

function detectType(handle: string): "email" | "phone" {
  return handle.includes("@") ? "email" : "phone";
}

// ─── Message parsing ────────────────────────────────────────
// Pattern: sender → body (1+ blocks) → recipients → ||

function parseMessages(blocks: readonly NotionBlock[]): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  const lines = blocks.map((b) => ({
    text: getBlockText(b),
    id: b.id,
    time: b.created_time,
  }));

  let i = 0;
  while (i < lines.length) {
    const text = lines[i].text.trim();
    if (text === "||") {
      i++;
      continue;
    }
    if (!looksLikeHandle(text)) {
      i++;
      continue;
    }

    const sender = text;
    const senderBlockId = lines[i].id;
    const timestamp = lines[i].time;

    // Collect body blocks
    let body = "";
    const bodyBlockIds: string[] = [];
    let j = i + 1;

    while (j < lines.length) {
      const nextText = lines[j].text.trim();
      if (nextText === "||") break;
      if (looksLikeHandle(nextText)) {
        // This handle is the recipients line if followed by:
        // - "||" delimiter (old format)
        // - end of blocks
        // - another handle (next message's sender, no-delimiter format)
        const afterIdx = j + 1;
        if (afterIdx >= lines.length) break;
        const afterText = lines[afterIdx].text.trim();
        if (afterText === "||" || looksLikeHandle(afterText)) break;
      }
      body += (body ? "\n" : "") + nextText;
      bodyBlockIds.push(lines[j].id);
      j++;
    }

    if (j >= lines.length || !body.trim()) {
      i = j + 1;
      continue;
    }

    // Collect ALL consecutive handles as recipients (group chats have multiple)
    const recipientHandles: string[] = [];
    const recipientBlockIds: string[] = [];
    while (j < lines.length) {
      const lineText = lines[j].text.trim();
      if (lineText === "||") { j++; break; }
      if (!looksLikeHandle(lineText)) break;

      // Handles may be space or newline separated (group chats)
      for (const h of extractHandles(lineText)) {
        recipientHandles.push(h);
      }
      recipientBlockIds.push(lines[j].id);
      j++;
    }

    // If the last collected handle is followed by a non-handle (body text),
    // it's actually the next message's sender — give it back
    if (
      recipientHandles.length > 1 &&
      j < lines.length &&
      !looksLikeHandle(lines[j].text.trim()) &&
      lines[j].text.trim() !== "||"
    ) {
      recipientHandles.pop();
      const poppedBlockId = recipientBlockIds.pop();
      if (poppedBlockId) j = lines.findIndex((l) => l.id === poppedBlockId);
    }

    if (recipientHandles.length === 0) {
      i = j;
      continue;
    }

    let k = j;

    messages.push({
      sender,
      body: body.trim().slice(0, 2000),
      recipients: recipientHandles,
      isGroupChat: recipientHandles.length > 1,
      blockIds: [senderBlockId, ...bodyBlockIds, ...recipientBlockIds],
      timestamp,
    });
    i = k;
  }

  return messages;
}

// ─── Contact matching ───────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, "");
}

async function findContactByHandle(
  userId: string,
  handle: string,
): Promise<{ id: string; name: string } | null> {
  if (detectType(handle) === "email") {
    return prisma.contact.findFirst({
      where: {
        userId,
        OR: [
          { email: { equals: handle, mode: "insensitive" } },
          { additionalEmails: { has: handle.toLowerCase() } },
        ],
      },
      select: { id: true, name: true },
    });
  }

  const normalized = normalizePhone(handle);
  let contact = await prisma.contact.findFirst({
    where: { userId, phone: normalized },
    select: { id: true, name: true },
  });

  if (!contact) {
    const last10 = normalized.replace(/\D/g, "").slice(-10);
    if (last10.length === 10) {
      contact = await prisma.contact.findFirst({
        where: { userId, phone: { endsWith: last10 } },
        select: { id: true, name: true },
      });
    }
  }

  return contact;
}

// ─── Main sync function ─────────────────────────────────────

export async function syncNotionMessages(
  userId: string,
  userHandles: readonly string[],
  notionToken: string,
  notionPageId: string,
  lastBlockId: string | null = null,
): Promise<NotionMessageSyncResult & { newLastBlockId: string | null }> {
  const result = {
    processed: 0,
    matched: 0,
    unmatched: 0,
    alreadySynced: 0,
    errors: 0,
    unmatchedHandles: [] as UnmatchedHandle[],
  };

  // Track unmatched handles grouped by handle string
  const unmatchedMap = new Map<
    string,
    { type: "email" | "phone"; count: number; preview: string; timestamp: string; isGroupChat: boolean }
  >();

  const normalizedUserHandles = new Set(
    userHandles.map((h) => h.toLowerCase().replace(/[\s\-()]/g, "")),
  );

  function isMe(handle: string): boolean {
    return normalizedUserHandles.has(
      handle.toLowerCase().replace(/[\s\-()]/g, ""),
    );
  }

  let blocks: NotionBlock[];
  try {
    blocks = await fetchAllBlocks(notionPageId, notionToken);
  } catch (error) {
    console.error("[notion-messages] Fetch failed:", error);
    return { ...result, errors: 1, newLastBlockId: lastBlockId };
  }

  // Incremental: skip blocks we've already processed
  if (lastBlockId) {
    const idx = blocks.findIndex((b) => b.id === lastBlockId);
    if (idx >= 0) blocks = blocks.slice(idx + 1);
  }

  if (blocks.length === 0) {
    return { ...result, newLastBlockId: lastBlockId };
  }

  const messages = parseMessages(blocks);
  result.processed = messages.length;
  let newLastBlockId = lastBlockId;

  for (const msg of messages) {
    const lastId = msg.blockIds[msg.blockIds.length - 1];
    newLastBlockId = lastId;

    // Dedup by sourceId
    const sourceId = `notion:${msg.blockIds[0]}`;
    const existing = await prisma.interaction.findFirst({
      where: { userId, sourceId },
    });
    if (existing) {
      result.alreadySynced++;
      continue;
    }

    const iSent = isMe(msg.sender);
    const direction = iSent ? "OUTBOUND" : "INBOUND";

    // Find the "other person"
    let contactHandle: string;
    if (iSent) {
      const others = msg.recipients.filter((r) => !isMe(r));
      contactHandle = others[0] || msg.recipients[0];
    } else {
      contactHandle = msg.sender;
    }

    const contact = await findContactByHandle(userId, contactHandle);
    if (!contact) {
      result.unmatched++;
      const existing = unmatchedMap.get(contactHandle);
      if (existing) {
        unmatchedMap.set(contactHandle, {
          ...existing,
          count: existing.count + 1,
          preview: msg.body.slice(0, 100),
          timestamp: msg.timestamp,
          isGroupChat: existing.isGroupChat || msg.isGroupChat,
        });
      } else {
        unmatchedMap.set(contactHandle, {
          type: detectType(contactHandle),
          count: 1,
          preview: msg.body.slice(0, 100),
          timestamp: msg.timestamp,
          isGroupChat: msg.isGroupChat,
        });
      }
      continue;
    }

    const channel =
      detectType(msg.sender) === "phone" ? "SMS" : "iMessage";
    let summary = msg.body;
    if (msg.isGroupChat) {
      summary = `(in group chat) ${msg.body}`;
    }

    try {
      const createdIx = await prisma.interaction.create({
        data: {
          userId,
          contactId: contact.id,
          type: "MESSAGE",
          direction,
          channel,
          subject: msg.isGroupChat ? "Group message" : null,
          summary: summary.slice(0, 500),
          occurredAt: new Date(msg.timestamp),
          sourceId,
          chatId: `1:1:${contact.id}:text`,
          isGroupChat: msg.isGroupChat ?? false,
        },
      });

      await prisma.contact.update({
        where: { id: contact.id },
        data: { lastInteraction: new Date(msg.timestamp) },
      });

      // Auto-resolve action items on outbound
      if (direction === "OUTBOUND") {
        await autoResolveOnOutbound(userId, contact.id, channel, new Date(msg.timestamp));
      }

      result.matched++;
    } catch (error) {
      console.error("[notion-messages] Error creating interaction:", error);
      result.errors++;
    }
  }

  // Build grouped unmatched handles sorted by message count
  result.unmatchedHandles = Array.from(unmatchedMap.entries())
    .map(([handle, info]) => ({
      handle,
      type: info.type,
      messageCount: info.count,
      lastPreview: info.preview,
      lastTimestamp: info.timestamp,
      isGroupChat: info.isGroupChat,
    }))
    .sort((a, b) => b.messageCount - a.messageCount);

  return { ...result, newLastBlockId };
}

// ─── Test connection ─────────────────────────────────────────

export async function testNotionConnection(
  notionToken: string,
  notionPageId: string,
): Promise<{
  ok: boolean;
  pageTitle?: string;
  blockCount?: number;
  error?: string;
}> {
  try {
    const page = await notionFetch(`/pages/${notionPageId}`, notionToken);
    const title =
      page.properties?.title?.title?.[0]?.plain_text || "Untitled";
    const blocksData = await notionFetch(
      `/blocks/${notionPageId}/children?page_size=1`,
      notionToken,
    );
    return {
      ok: true,
      pageTitle: title,
      blockCount: blocksData.results?.length ?? 0,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}
