import type { Client, Message, GroupChatId, ChatId } from "@open-wa/wa-automate";
import { jidToPhone, isGroupJid } from "./phone-utils.js";
import { syncMessages, type SyncMessage, type SyncPayload } from "./crm-client.js";

interface BufferedChat {
  phone: string;
  displayName: string;
  messages: SyncMessage[];
  isGroup: boolean;
  groupName?: string;
  groupId?: string;
}

const chatBuffer = new Map<string, BufferedChat>();
let flushTimer: ReturnType<typeof setInterval> | null = null;
let client: Client | null = null;

const FLUSH_INTERVAL_MS = 5_000;
const STATUS_BROADCAST = "status@broadcast";

const groupNameCache = new Map<string, string>();

async function getGroupName(chatId: string): Promise<string> {
  const cached = groupNameCache.get(chatId);
  if (cached) return cached;
  if (!client) return "Group";

  try {
    const meta = await client.getGroupInfo(chatId as GroupChatId);
    const name = meta?.subject || "Group";
    groupNameCache.set(chatId, name);
    return name;
  } catch {
    return "Group";
  }
}

/**
 * Extract the text body from an open-wa Message. open-wa flattens captions
 * onto `.caption` for media; plain text lives on `.body`.
 */
function extractText(msg: Message): string | null {
  const body = msg.body ?? msg.caption ?? null;
  if (!body || typeof body !== "string") return null;
  return body.trim() || null;
}

export function init(c: Client): void {
  client = c;
  flushTimer = setInterval(flushAll, FLUSH_INTERVAL_MS);
}

export async function handleMessage(msg: Message): Promise<void> {
  const chatId: ChatId | string = msg.from;
  if (!chatId || (chatId as string) === STATUS_BROADCAST) return;

  const text = extractText(msg);
  if (!text) return; // Skip media without captions, stickers, voice notes, etc.

  const isGroup = isGroupJid(chatId);
  const isFromMe = msg.fromMe ?? false;

  // open-wa timestamps are Unix seconds (sometimes ms). Detect and normalize.
  const rawTs = (msg.timestamp ?? msg.t ?? 0) as number;
  const tsMs = rawTs > 1e12 ? rawTs : rawTs * 1000;
  const timestamp = new Date(tsMs || Date.now()).toISOString();

  const messageId = msg.id || `openwa-${timestamp}-${Math.random()}`;

  let phone: string;
  let displayName: string;
  let senderName: string;
  let groupName: string | undefined;
  let groupId: string | undefined;

  if (isGroup) {
    // Group message: per-message sender lives on .author. open-wa also
    // exposes msg.sender for the participant's profile.
    const participantJid = msg.author || msg.sender?.id || "";
    phone = jidToPhone(participantJid) || "";
    senderName = isFromMe ? "You" : (msg.sender?.pushname || msg.sender?.name || phone || "Unknown");
    displayName = senderName;
    groupName = await getGroupName(chatId);
    groupId = chatId;
  } else {
    phone = jidToPhone(chatId) || "";
    displayName = msg.sender?.pushname || msg.sender?.name || phone || "Unknown";
    senderName = isFromMe ? "You" : displayName;
  }

  if (!phone && !isGroup) return;

  const syncMsg: SyncMessage = {
    text: text.slice(0, 500),
    timestamp,
    isFromMe,
    senderName,
    messageId,
  };

  const existing = chatBuffer.get(chatId);
  if (existing) {
    existing.messages.push(syncMsg);
  } else {
    chatBuffer.set(chatId, {
      phone,
      displayName,
      messages: [syncMsg],
      isGroup,
      groupName,
      groupId,
    });
  }
}

async function flushAll(): Promise<void> {
  if (chatBuffer.size === 0) return;

  const entries = [...chatBuffer.entries()];
  chatBuffer.clear();

  for (const [chatId, chat] of entries) {
    if (chat.messages.length === 0) continue;

    const payload: SyncPayload = {
      phone: chat.phone,
      displayName: chat.displayName,
      messages: chat.messages,
      isGroup: chat.isGroup,
      ...(chat.groupName ? { groupName: chat.groupName } : {}),
      ...(chat.groupId ? { groupId: chat.groupId } : {}),
    };

    const result = await syncMessages(payload);
    if (result.ok) {
      console.log(
        `[sync] Flushed ${chat.messages.length} msg(s) for ${chat.isGroup ? chat.groupName : chat.displayName}`,
      );
    } else {
      console.error(`[sync] Failed to flush ${chatId}: ${result.error}`);
    }
  }
}

export async function shutdown(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushAll();
}
