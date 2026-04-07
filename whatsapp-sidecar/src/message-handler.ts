import type { WASocket, proto } from "@whiskeysockets/baileys";
import { jidToPhone, isGroupJid } from "./phone-utils.js";
import { syncMessages, type SyncMessage, type SyncPayload } from "./crm-client.js";

// ─── Types ──────────────────────────────────────────────────

type WAMessage = proto.IWebMessageInfo;

interface BufferedChat {
  phone: string;
  displayName: string;
  messages: SyncMessage[];
  isGroup: boolean;
  groupName?: string;
  groupId?: string;
}

// ─── State ──────────────────────────────────────────────────

const chatBuffer = new Map<string, BufferedChat>();
let flushTimer: ReturnType<typeof setInterval> | null = null;
let socket: WASocket | null = null;

const FLUSH_INTERVAL_MS = 5_000;
const STATUS_BROADCAST = "status@broadcast";

// ─── Group name cache (avoid repeated fetches) ──────────────

const groupNameCache = new Map<string, string>();

async function getGroupName(jid: string): Promise<string> {
  const cached = groupNameCache.get(jid);
  if (cached) return cached;

  if (!socket) return "Group";

  try {
    const metadata = await socket.groupMetadata(jid);
    const name = metadata.subject || "Group";
    groupNameCache.set(jid, name);
    return name;
  } catch {
    return "Group";
  }
}

// ─── Text extraction ────────────────────────────────────────

function extractText(msg: WAMessage): string | null {
  const m = msg.message;
  if (!m) return null;

  // Plain text
  if (m.conversation) return m.conversation;

  // Quoted reply / link preview
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;

  // Image/video captions
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;

  return null;
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Initialize the message handler with a Baileys socket reference.
 * Starts the periodic flush timer.
 */
export function init(sock: WASocket): void {
  socket = sock;
  flushTimer = setInterval(flushAll, FLUSH_INTERVAL_MS);
}

/**
 * Process a single incoming or outgoing WhatsApp message.
 * Buffers it for batch delivery to the CRM.
 */
export async function handleMessage(msg: WAMessage): Promise<void> {
  const jid = msg.key.remoteJid;
  if (!jid || jid === STATUS_BROADCAST) return;

  const text = extractText(msg);
  if (!text) return; // Skip non-text messages (stickers, voice notes, etc.)

  const isGroup = isGroupJid(jid);
  const isFromMe = msg.key.fromMe ?? false;
  const timestamp = msg.messageTimestamp
    ? new Date(
        typeof msg.messageTimestamp === "number"
          ? msg.messageTimestamp * 1000
          : Number(msg.messageTimestamp) * 1000,
      ).toISOString()
    : new Date().toISOString();

  const messageId = msg.key.id || `${timestamp}-${Math.random()}`;

  let phone: string;
  let displayName: string;
  let senderName: string;
  let groupName: string | undefined;
  let groupId: string | undefined;

  if (isGroup) {
    // Group message: sender is in msg.key.participant
    const participantJid = msg.key.participant || "";
    phone = jidToPhone(participantJid) || "";
    senderName = isFromMe ? "You" : (msg.pushName || phone || "Unknown");
    displayName = senderName;
    groupName = await getGroupName(jid);
    groupId = jid;
  } else {
    // 1:1 message
    phone = jidToPhone(jid) || "";
    displayName = msg.pushName || phone || "Unknown";
    senderName = isFromMe ? "You" : displayName;
  }

  if (!phone && !isGroup) return; // Can't identify the contact

  const syncMsg: SyncMessage = {
    text: text.slice(0, 500),
    timestamp,
    isFromMe,
    senderName,
    messageId,
  };

  // Buffer by chat JID
  const existing = chatBuffer.get(jid);
  if (existing) {
    existing.messages.push(syncMsg);
  } else {
    chatBuffer.set(jid, {
      phone,
      displayName,
      messages: [syncMsg],
      isGroup,
      groupName,
      groupId,
    });
  }
}

/**
 * Flush all buffered messages to the CRM.
 */
async function flushAll(): Promise<void> {
  if (chatBuffer.size === 0) return;

  // Snapshot and clear the buffer atomically
  const entries = [...chatBuffer.entries()];
  chatBuffer.clear();

  for (const [jid, chat] of entries) {
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
      console.error(`[sync] Failed to flush ${jid}: ${result.error}`);
    }
  }
}

/**
 * Process a batch of history messages (initial sync backfill).
 * Groups by chat JID, takes last 20 per chat, buffers, and flushes.
 */
export async function handleHistoryMessages(messages: WAMessage[]): Promise<void> {
  // Group by chat JID
  const byJid = new Map<string, WAMessage[]>();
  for (const msg of messages) {
    const jid = msg.key.remoteJid;
    if (!jid || jid === STATUS_BROADCAST) continue;
    if (!extractText(msg)) continue;

    const list = byJid.get(jid) ?? [];
    byJid.set(jid, list);
    list.push(msg);
  }

  // Take last 20 per chat and process
  let count = 0;
  for (const [, msgs] of byJid) {
    const recent = msgs.slice(-20);
    for (const msg of recent) {
      await handleMessage(msg);
      count++;
    }
  }

  if (count > 0) {
    console.log(`[history] Buffered ${count} history messages, flushing...`);
    await flushAll();
  }
}

/**
 * Flush remaining buffer and stop the timer.
 * Call on graceful shutdown.
 */
export async function shutdown(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushAll();
}
