/**
 * One-shot history backfill. Runs the first time the sidecar successfully
 * connects on a new session, fetches the most recent N messages from each
 * known chat, and pushes them through the normal message handler so they
 * land in the CRM the same way live messages do.
 *
 * Gated by a sentinel file (.backfill-done in SESSION_DIR) so it doesn't
 * re-run on every process restart — the dedup at the /api/whatsapp/sync
 * endpoint would catch duplicate messageIds anyway, but skipping the
 * work entirely is cheaper than round-tripping every chat through Whisper-
 * adjacent API endpoints.
 *
 * Failures here are isolated and logged: a single chat that 500s shouldn't
 * abort the backfill of the other 200.
 */
import type { Client } from "@open-wa/wa-automate";
import { promises as fs } from "node:fs";
import path from "node:path";
import { handleMessage } from "./message-handler.js";
import { config } from "./config.js";

const SENTINEL_FILENAME = ".backfill-done";
const PER_CHAT_LIMIT = 20;
const CONCURRENCY = 4;

interface ChatId {
  toString(): string;
}

async function sentinelPath(): Promise<string> {
  return path.join(config.sessionDir, SENTINEL_FILENAME);
}

async function alreadyBackfilled(): Promise<boolean> {
  try {
    await fs.access(await sentinelPath());
    return true;
  } catch {
    return false;
  }
}

async function markBackfilled(): Promise<void> {
  const p = await sentinelPath();
  await fs.mkdir(path.dirname(p), { recursive: true }).catch(() => {});
  await fs.writeFile(p, new Date().toISOString(), "utf8").catch(() => {});
}

/**
 * Wrapper for client.getAllMessagesInChat that tolerates open-wa's mixed
 * return shapes (sometimes Message[], sometimes wrapping in a payload
 * field depending on version).
 */
async function fetchRecentMessages(
  client: Client,
  chatId: ChatId,
  limit: number,
): Promise<unknown[]> {
  try {
    // Signature: (chatId, includeMe, includeNotifications) — pulls all
    // messages, we slice ourselves. open-wa doesn't expose a server-side
    // limit on this method.
    const raw = await client.getAllMessagesInChat(
      chatId as unknown as Parameters<Client["getAllMessagesInChat"]>[0],
      true,
      false,
    );
    if (Array.isArray(raw)) return raw.slice(-limit);
    return [];
  } catch (err) {
    console.warn(`[openwa] getAllMessagesInChat failed for ${chatId}:`, err);
    return [];
  }
}

async function processChat(client: Client, chatId: ChatId): Promise<number> {
  const msgs = await fetchRecentMessages(client, chatId, PER_CHAT_LIMIT);
  let n = 0;
  for (const m of msgs) {
    try {
      await handleMessage(m as Parameters<typeof handleMessage>[0]);
      n++;
    } catch (err) {
      console.warn(`[openwa] handleMessage failed in backfill:`, err);
    }
  }
  return n;
}

/**
 * Public entry point. Idempotent across restarts via sentinel file.
 */
export async function runHistoryBackfill(client: Client): Promise<void> {
  if (await alreadyBackfilled()) {
    console.log("[openwa] History backfill already done — skipping.");
    return;
  }

  console.log("[openwa] Starting one-shot history backfill...");

  let chatIds: ChatId[];
  try {
    chatIds = (await client.getAllChatIds()) as ChatId[];
  } catch (err) {
    console.error("[openwa] getAllChatIds failed; aborting backfill:", err);
    return;
  }

  console.log(`[openwa] Backfilling history for ${chatIds.length} chat(s).`);

  let totalMessages = 0;
  let chatsDone = 0;
  // Bound parallelism so we don't melt the open-wa Chrome instance.
  for (let i = 0; i < chatIds.length; i += CONCURRENCY) {
    const batch = chatIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((id) => processChat(client, id)));
    for (const n of results) totalMessages += n;
    chatsDone += batch.length;
    if (chatsDone % 50 === 0 || chatsDone === chatIds.length) {
      console.log(
        `[openwa] Backfill progress: ${chatsDone}/${chatIds.length} chats, ${totalMessages} messages`,
      );
    }
  }

  await markBackfilled();
  console.log(
    `[openwa] Backfill complete: ${totalMessages} messages across ${chatIds.length} chats.`,
  );
}
