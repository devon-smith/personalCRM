import { execFile } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ─── Types ───────────────────────────────────────────────────

export interface IMessageConversation {
  /** Phone number (E.164) or email address */
  handleId: string;
  /** "iMessage" or "SMS" */
  service: string;
  /** Total messages in the conversation */
  messageCount: number;
  /** Most recent message date */
  latestDate: Date;
  /** Earliest message date */
  earliestDate: Date;
  /** Messages sent by the user */
  sentCount: number;
  /** Messages received by the user */
  receivedCount: number;
}

export interface IMessageDetail {
  guid: string;
  text: string | null;
  date: Date;
  isFromMe: boolean;
  handleId: string;
  service: string;
  /** Group chat display name (null for 1:1 conversations) */
  chatName: string | null;
  /** Whether this message is from a group chat */
  isGroupChat: boolean;
  /** Stable chat identifier from iMessage (chat.ROWID) */
  chatRowId: number | null;
}

export interface IMessageResult {
  conversations: IMessageConversation[];
  total: number;
  error: string | null;
}

export interface IMessageSyncResult {
  messages: IMessageDetail[];
  total: number;
  error: string | null;
}

// ─── Constants ───────────────────────────────────────────────

const DB_PATH = join(homedir(), "Library", "Messages", "chat.db");

/** Apple Cocoa epoch offset: seconds between 1970-01-01 and 2001-01-01 */
const APPLE_EPOCH_OFFSET = 978307200;

// ─── Helpers ─────────────────────────────────────────────────

function appleTimestampToDate(nanoseconds: number): Date {
  const unixSeconds = nanoseconds / 1_000_000_000 + APPLE_EPOCH_OFFSET;
  return new Date(unixSeconds * 1000);
}

function daysAgoAppleTimestamp(days: number): number {
  const unixSeconds = Date.now() / 1000 - days * 86400;
  return (unixSeconds - APPLE_EPOCH_OFFSET) * 1_000_000_000;
}

function runQuery<T>(query: string): Promise<T[]> {
  return new Promise((resolve) => {
    execFile(
      "sqlite3",
      ["-json", "-readonly", DB_PATH, query],
      { timeout: 15000, maxBuffer: 100 * 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve([]);
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve([]);
        }
      },
    );
  });
}

// normalizePhone is now in src/lib/name-utils.ts
export { normalizePhone } from "./name-utils";

// ─── Public API ──────────────────────────────────────────────

/**
 * Check if iMessage database is accessible.
 * Returns null if accessible, or an error message if not.
 */
export function checkIMessageAccess(): string | null {
  if (!existsSync(DB_PATH)) {
    return "iMessage database not found. Make sure Messages.app has been used on this Mac.";
  }
  // The actual read will fail if FDA isn't granted, but we can't check that statically
  return null;
}

/**
 * Get a summary of all iMessage conversations from the last N days.
 * Groups messages by handle (phone/email) with counts and date ranges.
 */
export async function getConversations(
  days: number = 90,
): Promise<IMessageResult> {
  const accessError = checkIMessageAccess();
  if (accessError) {
    return { conversations: [], total: 0, error: accessError };
  }

  const minDate = daysAgoAppleTimestamp(days);

  const query = `
    SELECT
      h.id AS handleId,
      h.service AS service,
      COUNT(*) AS messageCount,
      MAX(m.date) AS latestDate,
      MIN(m.date) AS earliestDate,
      SUM(m.is_from_me) AS sentCount,
      COUNT(*) - SUM(m.is_from_me) AS receivedCount
    FROM message m
    JOIN handle h ON m.handle_id = h.ROWID
    WHERE m.date > ${minDate}
      AND m.is_empty = 0
      AND m.is_service_message = 0
      AND h.id IS NOT NULL
      AND h.id != ''
    GROUP BY h.id, h.service
    ORDER BY latestDate DESC;
  `.trim();

  interface RawRow {
    handleId: string;
    service: string;
    messageCount: number;
    latestDate: number;
    earliestDate: number;
    sentCount: number;
    receivedCount: number;
  }

  try {
    const rows = await runQuery<RawRow>(query);

    const conversations: IMessageConversation[] = rows.map((row) => ({
      handleId: row.handleId,
      service: row.service,
      messageCount: row.messageCount,
      latestDate: appleTimestampToDate(row.latestDate),
      earliestDate: appleTimestampToDate(row.earliestDate),
      sentCount: row.sentCount,
      receivedCount: row.receivedCount,
    }));

    return { conversations, total: conversations.length, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to read iMessage database";
    if (message.includes("not permitted") || message.includes("unable to open")) {
      return {
        conversations: [],
        total: 0,
        error:
          "Full Disk Access required. Go to System Settings → Privacy & Security → Full Disk Access and enable it for Terminal.",
      };
    }
    return { conversations: [], total: 0, error: message };
  }
}

/**
 * Get individual messages for a specific handle from the last N days.
 * Used for logging interactions matched to a contact.
 */
export async function getMessagesForHandle(
  handleId: string,
  days: number = 90,
): Promise<IMessageSyncResult> {
  const accessError = checkIMessageAccess();
  if (accessError) {
    return { messages: [], total: 0, error: accessError };
  }

  const minDate = daysAgoAppleTimestamp(days);

  // Escape single quotes in handleId for SQL safety
  const safeHandle = handleId.replace(/'/g, "''");

  // Two queries unioned:
  // 1) Direct/inbound messages where handle_id matches the contact
  // 2) Outbound messages in chats that include this handle
  //    (outbound group chat messages often have handle_id=0 or point to
  //     a different participant, so the direct handle filter misses them)
  const query = `
    SELECT
      m.guid,
      m.text,
      m.date,
      m.is_from_me AS isFromMe,
      '${safeHandle}' AS handleId,
      COALESCE(h.service, 'iMessage') AS service,
      COALESCE(NULLIF(c.display_name, ''), CASE WHEN COUNT(DISTINCT chj2.handle_id) > 1 THEN 'gc:' || c.chat_identifier ELSE NULL END) AS chatName,
      CASE WHEN COUNT(DISTINCT chj2.handle_id) > 1 THEN 1 ELSE 0 END AS isGroupChat,
      c.ROWID AS chatRowId
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    LEFT JOIN chat c ON c.ROWID = cmj.chat_id
    LEFT JOIN chat_handle_join chj2 ON chj2.chat_id = c.ROWID
    WHERE (
      h.id = '${safeHandle}'
      OR (
        m.is_from_me = 1
        AND cmj.chat_id IN (
          SELECT chj3.chat_id FROM chat_handle_join chj3
          JOIN handle h2 ON h2.ROWID = chj3.handle_id
          WHERE h2.id = '${safeHandle}'
        )
      )
    )
      AND m.date > ${minDate}
      AND m.is_empty = 0
      AND m.is_service_message = 0
    GROUP BY m.ROWID
    ORDER BY m.date DESC
    LIMIT 500;
  `.trim();

  interface RawMsg {
    guid: string;
    text: string | null;
    date: number;
    isFromMe: number;
    handleId: string;
    service: string;
    chatName: string | null;
    isGroupChat: number;
    chatRowId: number | null;
  }

  try {
    const rows = await runQuery<RawMsg>(query);

    const messages: IMessageDetail[] = rows.map((row) => ({
      guid: row.guid,
      text: row.text,
      date: appleTimestampToDate(row.date),
      isFromMe: row.isFromMe === 1,
      handleId: row.handleId,
      service: row.service,
      chatName: row.chatName || null,
      isGroupChat: row.isGroupChat === 1,
      chatRowId: row.chatRowId ?? null,
    }));

    return { messages, total: messages.length, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to read messages";
    return { messages: [], total: 0, error: message };
  }
}

/**
 * Get ALL individual messages from the last N days across all handles.
 * Used for bulk backfill — returns every message in one query.
 * Filters out short-code SMS (handles < 7 digits) and empty messages.
 */
export async function getAllMessages(
  days: number = 90,
): Promise<IMessageSyncResult> {
  const accessError = checkIMessageAccess();
  if (accessError) {
    return { messages: [], total: 0, error: accessError };
  }

  const minDate = daysAgoAppleTimestamp(days);

  const query = `
    SELECT
      m.guid,
      m.text,
      m.date,
      m.is_from_me AS isFromMe,
      h.id AS handleId,
      h.service AS service,
      COALESCE(NULLIF(c.display_name, ''), CASE WHEN COUNT(DISTINCT chj2.handle_id) > 1 THEN 'gc:' || c.chat_identifier ELSE NULL END) AS chatName,
      CASE WHEN COUNT(DISTINCT chj2.handle_id) > 1 THEN 1 ELSE 0 END AS isGroupChat,
      c.ROWID AS chatRowId
    FROM message m
    JOIN handle h ON m.handle_id = h.ROWID
    LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    LEFT JOIN chat c ON c.ROWID = cmj.chat_id
    LEFT JOIN chat_handle_join chj2 ON chj2.chat_id = c.ROWID
    WHERE m.date > ${minDate}
      AND m.is_empty = 0
      AND m.is_service_message = 0
      AND h.id IS NOT NULL
      AND h.id != ''
      AND m.text IS NOT NULL
      AND LENGTH(m.text) > 0
    GROUP BY m.ROWID
    ORDER BY m.date ASC;
  `.trim();

  interface RawMsg {
    guid: string;
    text: string | null;
    date: number;
    isFromMe: number;
    handleId: string;
    service: string;
    chatName: string | null;
    isGroupChat: number;
    chatRowId: number | null;
  }

  try {
    const rows = await runQuery<RawMsg>(query);

    const messages: IMessageDetail[] = rows.map((row) => ({
      guid: row.guid,
      text: row.text,
      date: appleTimestampToDate(row.date),
      isFromMe: row.isFromMe === 1,
      handleId: row.handleId,
      service: row.service,
      chatName: row.chatName || null,
      isGroupChat: row.isGroupChat === 1,
      chatRowId: row.chatRowId ?? null,
    }));

    return { messages, total: messages.length, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to read messages";
    return { messages: [], total: 0, error: message };
  }
}

/**
 * Get all messages from the last N days, grouped by day and handle.
 * Returns one "interaction summary" per day per handle — useful for
 * creating interaction records without one per message.
 */
export async function getDailyConversationSummaries(
  days: number = 90,
): Promise<{
  summaries: Array<{
    handleId: string;
    service: string;
    date: string; // YYYY-MM-DD
    messageCount: number;
    sentCount: number;
    receivedCount: number;
    /** Latest message guid for dedup sourceId */
    latestGuid: string;
  }>;
  error: string | null;
}> {
  const accessError = checkIMessageAccess();
  if (accessError) {
    return { summaries: [], error: accessError };
  }

  const minDate = daysAgoAppleTimestamp(days);

  const query = `
    SELECT
      h.id AS handleId,
      h.service AS service,
      date(m.date / 1000000000 + ${APPLE_EPOCH_OFFSET}, 'unixepoch', 'localtime') AS day,
      COUNT(*) AS messageCount,
      SUM(m.is_from_me) AS sentCount,
      COUNT(*) - SUM(m.is_from_me) AS receivedCount,
      MAX(m.guid) AS latestGuid
    FROM message m
    JOIN handle h ON m.handle_id = h.ROWID
    WHERE m.date > ${minDate}
      AND m.is_empty = 0
      AND m.is_service_message = 0
      AND h.id IS NOT NULL
      AND h.id != ''
    GROUP BY h.id, h.service, day
    ORDER BY day DESC;
  `.trim();

  interface RawSummary {
    handleId: string;
    service: string;
    day: string;
    messageCount: number;
    sentCount: number;
    receivedCount: number;
    latestGuid: string;
  }

  try {
    const rows = await runQuery<RawSummary>(query);

    const summaries = rows.map((row) => ({
      handleId: row.handleId,
      service: row.service,
      date: row.day,
      messageCount: row.messageCount,
      sentCount: row.sentCount,
      receivedCount: row.receivedCount,
      latestGuid: row.latestGuid,
    }));

    return { summaries, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to read messages";
    return { summaries: [], error: message };
  }
}

// ─── Chat Lookup ──────────────────────────────────────────────

export interface ChatInfo {
  chatRowId: number;
  chatName: string | null;
  chatIdentifier: string;
  isGroupChat: boolean;
  memberCount: number;
}

/**
 * Get a mapping of handle → chat ROWIDs from iMessage's chat.db.
 * Used to backfill correct chatId on existing Interactions.
 *
 * Deduplicates chats using group_id: iMessage creates separate chat ROWIDs
 * for the same conversation when switching between iMessage and SMS services.
 * These share the same group_id but have different chat_identifiers.
 * The ROWID with the most messages becomes canonical; all others map to it.
 *
 * Returns:
 * - handleToChats: Map from handle (phone/email) → list of ChatInfo (canonical only)
 * - chatById: Map from chatRowId → ChatInfo (includes canonical mapping)
 * - canonicalRowId: Map from any ROWID → the canonical ROWID for that conversation
 */
export async function getChatLookup(): Promise<{
  handleToChats: Map<string, ChatInfo[]>;
  chatById: Map<number, ChatInfo>;
  canonicalRowId: Map<number, number>;
  error: string | null;
}> {
  const accessError = checkIMessageAccess();
  if (accessError) {
    return {
      handleToChats: new Map(),
      chatById: new Map(),
      canonicalRowId: new Map(),
      error: accessError,
    };
  }

  const query = `
    SELECT
      c.ROWID AS chatRowId,
      COALESCE(NULLIF(c.display_name, ''), NULL) AS chatName,
      c.chat_identifier AS chatIdentifier,
      c.group_id AS groupId,
      h.id AS handleId,
      (SELECT COUNT(DISTINCT chj2.handle_id)
       FROM chat_handle_join chj2
       WHERE chj2.chat_id = c.ROWID) AS memberCount,
      (SELECT COUNT(*)
       FROM chat_message_join cmj
       WHERE cmj.chat_id = c.ROWID) AS msgCount
    FROM chat c
    JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
    JOIN handle h ON h.ROWID = chj.handle_id;
  `.trim();

  interface RawRow {
    chatRowId: number;
    chatName: string | null;
    chatIdentifier: string;
    groupId: string | null;
    handleId: string;
    memberCount: number;
    msgCount: number;
  }

  try {
    const rows = await runQuery<RawRow>(query);

    // Step 1: Build canonical ROWID map using group_id as the dedup key.
    // group_id is a UUID that stays consistent across iMessage/SMS service splits.
    // For chats without group_id, fall back to chat_identifier.
    interface ChatEntry {
      rowId: number;
      msgCount: number;
      chatName: string | null;
      memberCount: number;
      chatIdentifier: string;
    }

    const byGroupKey = new Map<string, ChatEntry[]>();
    for (const row of rows) {
      const groupKey = (row.groupId && row.groupId !== "")
        ? `gid:${row.groupId}`
        : `ci:${row.chatIdentifier}`;
      const group = byGroupKey.get(groupKey) ?? [];
      if (!group.some((g) => g.rowId === row.chatRowId)) {
        group.push({
          rowId: row.chatRowId,
          msgCount: row.msgCount,
          chatName: row.chatName,
          memberCount: row.memberCount,
          chatIdentifier: row.chatIdentifier,
        });
      }
      byGroupKey.set(groupKey, group);
    }

    // For each group, pick the ROWID with most messages as canonical
    const canonicalRowId = new Map<number, number>();
    // Also track the aggregate memberCount across all ROWIDs in a group
    const canonicalMemberCount = new Map<number, number>();
    for (const [, group] of byGroupKey) {
      const sorted = [...group].sort((a, b) => b.msgCount - a.msgCount);
      const canonical = sorted[0];
      // Use the max memberCount from any ROWID in the group
      const maxMembers = Math.max(...sorted.map((e) => e.memberCount));
      canonicalMemberCount.set(canonical.rowId, maxMembers);
      for (const entry of sorted) {
        canonicalRowId.set(entry.rowId, canonical.rowId);
      }
    }

    // Step 2: Build maps using canonical ROWIDs only
    const handleToChats = new Map<string, ChatInfo[]>();
    const chatById = new Map<number, ChatInfo>();

    for (const row of rows) {
      const canonical = canonicalRowId.get(row.chatRowId) ?? row.chatRowId;

      // Only build ChatInfo for canonical ROWIDs
      if (canonical !== row.chatRowId) continue;

      // Use aggregated memberCount for group chat detection
      const effectiveMembers = canonicalMemberCount.get(canonical) ?? row.memberCount;

      const info: ChatInfo = {
        chatRowId: canonical,
        chatName: row.chatName || null,
        chatIdentifier: row.chatIdentifier,
        isGroupChat: effectiveMembers > 1,
        memberCount: effectiveMembers,
      };

      chatById.set(canonical, info);

      const handle = row.handleId;
      const existing = handleToChats.get(handle) ?? [];
      if (!existing.some((c) => c.chatRowId === canonical)) {
        existing.push(info);
      }
      handleToChats.set(handle, existing);
    }

    // Also register non-canonical ROWIDs' handles pointing to canonical ChatInfo
    for (const row of rows) {
      const canonical = canonicalRowId.get(row.chatRowId) ?? row.chatRowId;
      if (canonical === row.chatRowId) continue; // already handled above

      const info = chatById.get(canonical);
      if (!info) continue;

      const handle = row.handleId;
      const existing = handleToChats.get(handle) ?? [];
      if (!existing.some((c) => c.chatRowId === canonical)) {
        existing.push(info);
      }
      handleToChats.set(handle, existing);
    }

    return { handleToChats, chatById, canonicalRowId, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to read chat lookup";
    return {
      handleToChats: new Map(),
      chatById: new Map(),
      canonicalRowId: new Map(),
      error: message,
    };
  }
}

/**
 * Bulk lookup: get GUID → chatRowId mapping for all messages in chat.db
 * from the last N days. Used by the migrate endpoint to assign correct
 * chatIds based on per-message data instead of per-contact guesses.
 *
 * Returns canonical ROWIDs (deduped by group_id).
 */
export async function getMessageChatMapping(
  days: number,
  canonicalRowId: Map<number, number>,
): Promise<{ guidToChat: Map<string, { chatRowId: number; isGroupChat: boolean; chatName: string | null }>; error: string | null }> {
  const accessError = checkIMessageAccess();
  if (accessError) return { guidToChat: new Map(), error: accessError };

  const minDate = daysAgoAppleTimestamp(days);

  const query = `
    SELECT
      m.guid AS guid,
      c.ROWID AS chatRowId,
      COALESCE(NULLIF(c.display_name, ''), NULL) AS chatName,
      (SELECT COUNT(DISTINCT chj2.handle_id)
       FROM chat_handle_join chj2
       WHERE chj2.chat_id = c.ROWID) AS memberCount
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE m.date > ${minDate}
    ORDER BY m.date DESC;
  `.trim();

  interface Row {
    guid: string;
    chatRowId: number;
    chatName: string | null;
    memberCount: number;
  }

  try {
    const rows = await runQuery<Row>(query);
    const guidToChat = new Map<string, { chatRowId: number; isGroupChat: boolean; chatName: string | null }>();

    for (const row of rows) {
      const canonical = canonicalRowId.get(row.chatRowId) ?? row.chatRowId;
      guidToChat.set(row.guid, {
        chatRowId: canonical,
        isGroupChat: row.memberCount > 1,
        chatName: row.chatName || null,
      });
    }

    return { guidToChat, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to query message-chat mapping";
    return { guidToChat: new Map(), error: message };
  }
}

/**
 * Diagnostic: return chat.db duplication info for debugging.
 * Checks BOTH chat_identifier and group_id as potential dedup keys.
 */
export async function getChatDuplicates(): Promise<{
  byIdentifier: { key: string; rowIds: number[]; msgCounts: number[]; services: string[] }[];
  byGroupId: { key: string; rowIds: number[]; msgCounts: number[]; chatIdentifiers: string[]; services: string[] }[];
  allChats: {
    rowId: number; chatIdentifier: string; groupId: string | null;
    service: string; displayName: string | null; msgCount: number; memberCount: number;
  }[];
  error: string | null;
}> {
  const accessError = checkIMessageAccess();
  if (accessError) return { byIdentifier: [], byGroupId: [], allChats: [], error: accessError };

  const query = `
    SELECT
      c.ROWID AS rowId,
      c.chat_identifier AS chatIdentifier,
      c.group_id AS groupId,
      c.service_name AS service,
      c.display_name AS displayName,
      (SELECT COUNT(*) FROM chat_message_join cmj WHERE cmj.chat_id = c.ROWID) AS msgCount,
      (SELECT COUNT(DISTINCT chj.handle_id) FROM chat_handle_join chj WHERE chj.chat_id = c.ROWID) AS memberCount
    FROM chat c
    ORDER BY msgCount DESC;
  `.trim();

  interface Row {
    rowId: number;
    chatIdentifier: string;
    groupId: string | null;
    service: string;
    displayName: string | null;
    msgCount: number;
    memberCount: number;
  }

  try {
    const rows = await runQuery<Row>(query);

    // Group by chat_identifier
    const byIdent = new Map<string, { rowIds: number[]; msgCounts: number[]; services: string[] }>();
    for (const r of rows) {
      const entry = byIdent.get(r.chatIdentifier) ?? { rowIds: [], msgCounts: [], services: [] };
      entry.rowIds.push(r.rowId);
      entry.msgCounts.push(r.msgCount);
      entry.services.push(r.service);
      byIdent.set(r.chatIdentifier, entry);
    }

    // Group by group_id (non-null/non-empty only)
    const byGroup = new Map<string, { rowIds: number[]; msgCounts: number[]; chatIdentifiers: string[]; services: string[] }>();
    for (const r of rows) {
      if (!r.groupId || r.groupId === "") continue;
      const entry = byGroup.get(r.groupId) ?? { rowIds: [], msgCounts: [], chatIdentifiers: [], services: [] };
      entry.rowIds.push(r.rowId);
      entry.msgCounts.push(r.msgCount);
      entry.chatIdentifiers.push(r.chatIdentifier);
      entry.services.push(r.service);
      byGroup.set(r.groupId, entry);
    }

    return {
      byIdentifier: [...byIdent.entries()]
        .filter(([, v]) => v.rowIds.length > 1)
        .map(([key, v]) => ({ key, ...v })),
      byGroupId: [...byGroup.entries()]
        .filter(([, v]) => v.rowIds.length > 1)
        .map(([key, v]) => ({ key, ...v })),
      allChats: rows.map((r) => ({
        rowId: r.rowId,
        chatIdentifier: r.chatIdentifier,
        groupId: r.groupId,
        service: r.service,
        displayName: r.displayName,
        msgCount: r.msgCount,
        memberCount: r.memberCount,
      })),
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to query chat duplicates";
    return { byIdentifier: [], byGroupId: [], allChats: [], error: message };
  }
}
