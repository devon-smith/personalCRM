import { prisma } from "@/lib/prisma";
import {
  getActiveChats,
  getMessagesForChat,
  appleTimestampToDate,
  getGuidToChatRaw,
} from "@/lib/imessage";
import { autoResolveOnOutbound } from "@/lib/auto-resolve";
import { buildContactLookupMaps } from "./handle-resolver";
import { resolveHandleToContact, ContactLookupMaps } from "./handle-resolver";
import { resolveChatsToContacts, groupChatsByContacts, ChatGroup } from "./chat-merger";

// ─── Types ───────────────────────────────────────────────────

export interface IMessageSyncResult {
  readonly chatsScanned: number;
  readonly chatsMerged: number;
  readonly messagesCreated: number;
  readonly messagesSkipped: number;
  readonly chatIdsCorrected: number;
  readonly contactsMatched: number;
  readonly unmatchedChats: number;
  readonly errors: readonly string[];
}

// ─── Main sync function ─────────────────────────────────────

export async function syncIMessages(userId: string, days: number): Promise<IMessageSyncResult> {
  // 1. Get all chats with recent messages
  const { chats, error: chatError } = await getActiveChats(days);
  if (chatError) {
    throw new Error(chatError);
  }

  // 2. Build contact lookup maps
  const lookups = await buildContactLookupMaps(userId);

  // 3. Get existing sourceIds to skip duplicates
  const existingSourceIds = await loadExistingSourceIds(userId);

  // 4. Resolve chats to contacts and group by contact set
  const { resolved, unmatchedCount, errors } = await resolveChatsToContacts(chats, lookups);
  const chatGroups = groupChatsByContacts(resolved);

  // 5. Process each chat group
  let messagesCreated = 0;
  let messagesSkipped = 0;
  let chatIdsCorrected = 0;
  let chatsMerged = 0;
  const matchedContactIds = new Set<string>();
  const outboundContacts = new Map<string, { channel: string; occurredAt: Date }>();

  for (const group of chatGroups) {
    if (group.members.length > 1) {
      chatsMerged += group.members.length - 1;
    }

    // Upsert Thread for this chat group
    const thread = await upsertThread(userId, group);

    const groupResult = await processMessageGroup(
      userId, group, lookups, existingSourceIds, days, thread.id,
    );

    messagesCreated += groupResult.messagesCreated;
    messagesSkipped += groupResult.messagesSkipped;
    chatIdsCorrected += groupResult.chatIdsCorrected;
    errors.push(...groupResult.errors);
    for (const cId of groupResult.matchedContactIds) matchedContactIds.add(cId);
    for (const [cId, info] of groupResult.outboundContacts) {
      const prev = outboundContacts.get(cId);
      if (!prev || info.occurredAt > prev.occurredAt) {
        outboundContacts.set(cId, info);
      }
    }

    // Update sync states for all participants
    await updateSyncStates(userId, group);
  }

  // 6. Bulk chatId correction
  chatIdsCorrected += await correctChatIds(userId, chatGroups, days);

  // 7. Update lastInteraction for matched contacts
  await updateLastInteractions(userId, matchedContactIds);

  // 8. Auto-resolve action items for contacts with outbound messages
  for (const [cId, { channel, occurredAt }] of outboundContacts) {
    await autoResolveOnOutbound(userId, cId, channel, occurredAt);
  }

  return {
    chatsScanned: chats.length,
    chatsMerged,
    messagesCreated,
    messagesSkipped,
    chatIdsCorrected,
    contactsMatched: matchedContactIds.size,
    unmatchedChats: unmatchedCount,
    errors,
  };
}

// ─── Process messages for a merged chat group ───────────────

interface GroupProcessResult {
  messagesCreated: number;
  messagesSkipped: number;
  chatIdsCorrected: number;
  matchedContactIds: Set<string>;
  outboundContacts: Map<string, { channel: string; occurredAt: Date }>;
  errors: string[];
}

async function processMessageGroup(
  userId: string,
  group: ChatGroup,
  lookups: ContactLookupMaps,
  existingSourceIds: ExistingSourceIds,
  days: number,
  threadId: string,
): Promise<GroupProcessResult> {
  const { chatId, isGroupChat, chatName, mergedHandleToContact, canonical } = group;
  const defaultContactId = canonical.defaultContactId;

  let messagesCreated = 0;
  let messagesSkipped = 0;
  let chatIdsCorrected = 0;
  const matchedContactIds = new Set<string>();
  const outboundContacts = new Map<string, { channel: string; occurredAt: Date }>();
  const errors: string[] = [];

  for (const rc of group.members) {
    const { messages, error: msgError } = await getMessagesForChat(rc.chat.chatRowId, days);
    if (msgError) {
      errors.push(`chat ${rc.chat.chatRowId}: ${msgError}`);
      continue;
    }

    const channelLabel = rc.chat.serviceName === "SMS" ? "SMS" : "iMessage";

    for (const msg of messages) {
      const sourceId = `imsg-ind:${msg.guid}`;

      // Correct chatId for existing messages before skipping
      if (existingSourceIds.indIds.has(sourceId) || existingSourceIds.backfillGuids.has(msg.guid)) {
        const corrected = await correctExistingMessage(
          userId, msg, sourceId, chatId, isGroupChat, chatName,
          defaultContactId, mergedHandleToContact, lookups, existingSourceIds,
        );
        if (corrected) chatIdsCorrected++;
        messagesSkipped++;
        continue;
      }

      if (!msg.text || msg.text.trim().length === 0) continue;

      // Resolve contactId from the actual sender handle
      const contactId = msg.isFromMe
        ? defaultContactId
        : (msg.senderHandle
            ? (mergedHandleToContact.get(msg.senderHandle)
              ?? resolveHandleToContact(msg.senderHandle, lookups))
            : defaultContactId);

      if (!contactId) continue;
      matchedContactIds.add(contactId);

      const direction = msg.isFromMe ? "OUTBOUND" : "INBOUND";
      const occurredAt = appleTimestampToDate(msg.date);

      let summary = msg.text.length > 200
        ? msg.text.slice(0, 200) + "..."
        : msg.text;
      if (isGroupChat) {
        summary = `(in group chat) ${summary}`;
      }

      const subject = chatName
        ? chatName
        : isGroupChat
          ? "Group message"
          : `${channelLabel} message`;

      try {
        await prisma.interaction.create({
          data: {
            userId,
            contactId,
            type: "MESSAGE",
            direction,
            channel: channelLabel,
            subject,
            summary,
            occurredAt,
            sourceId,
            chatId,
            isGroupChat,
            chatName: isGroupChat ? chatName : null,
            threadId,
          },
        });
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes("Unique constraint")) {
          messagesSkipped++;
          existingSourceIds.indIds.add(sourceId);
          continue;
        }
        throw e;
      }

      existingSourceIds.indIds.add(sourceId);
      messagesCreated++;

      if (direction === "OUTBOUND") {
        const prev = outboundContacts.get(contactId);
        if (!prev || occurredAt > prev.occurredAt) {
          outboundContacts.set(contactId, { channel: channelLabel, occurredAt });
        }
      }
    }
  }

  return { messagesCreated, messagesSkipped, chatIdsCorrected, matchedContactIds, outboundContacts, errors };
}

// ─── Correct chatId on an existing interaction ──────────────

async function correctExistingMessage(
  userId: string,
  msg: { guid: string; isFromMe: boolean; senderHandle: string | null },
  sourceId: string,
  chatId: string,
  isGroupChat: boolean,
  chatName: string | null,
  defaultContactId: string,
  mergedHandleToContact: Map<string, string>,
  lookups: ContactLookupMaps,
  existingSourceIds: ExistingSourceIds,
): Promise<boolean> {
  const lookupId = existingSourceIds.indIds.has(sourceId)
    ? sourceId
    : `imsg:${msg.guid}`;

  const existing = await prisma.interaction.findFirst({
    where: { userId, sourceId: lookupId },
    select: { id: true, chatId: true, contactId: true },
  });

  if (!existing || existing.chatId === chatId) return false;

  const correctedContactId = msg.isFromMe
    ? defaultContactId
    : (msg.senderHandle
        ? (mergedHandleToContact.get(msg.senderHandle)
          ?? resolveHandleToContact(msg.senderHandle, lookups))
        : defaultContactId);

  await prisma.interaction.update({
    where: { id: existing.id },
    data: {
      chatId,
      isGroupChat,
      chatName: isGroupChat ? chatName : null,
      ...(correctedContactId && correctedContactId !== existing.contactId
        ? { contactId: correctedContactId }
        : {}),
    },
  });

  return true;
}

// ─── Load existing sourceIds for dedup ──────────────────────

interface ExistingSourceIds {
  readonly indIds: Set<string | null>;
  readonly backfillGuids: Set<string>;
}

async function loadExistingSourceIds(userId: string): Promise<ExistingSourceIds> {
  const [indRows, backfillRows] = await Promise.all([
    prisma.interaction.findMany({
      where: { userId, sourceId: { startsWith: "imsg-ind:" } },
      select: { sourceId: true },
    }),
    prisma.interaction.findMany({
      where: { userId, sourceId: { startsWith: "imsg:" } },
      select: { sourceId: true },
    }),
  ]);

  return {
    indIds: new Set(indRows.map((i) => i.sourceId)),
    backfillGuids: new Set(
      backfillRows
        .map((i) => (i.sourceId ?? "").replace("imsg:", ""))
        .filter((g) => g && !g.startsWith("ind:")),
    ),
  };
}

// ─── Update sync states ─────────────────────────────────────

async function updateSyncStates(userId: string, group: ChatGroup): Promise<void> {
  for (const rc of group.members) {
    for (const p of rc.participants) {
      const contactId = group.mergedHandleToContact.get(p.handleId);
      if (!contactId) continue;

      await prisma.iMessageSyncState.upsert({
        where: {
          userId_handleId: { userId, handleId: p.handleId },
        },
        create: {
          userId,
          handleId: p.handleId,
          contactId,
          service: p.service,
          lastSyncAt: new Date(),
          messageCount: 0,
        },
        update: {
          contactId,
          lastSyncAt: new Date(),
        },
      });
    }
  }
}

// ─── Upsert Thread for a chat group ─────────────────────────

async function upsertThread(
  userId: string,
  group: ChatGroup,
): Promise<{ id: string }> {
  const sourceThreadId = String(group.canonical.chat.chatRowId);
  const contactIds = [...group.canonical.contactIds];

  const thread = await prisma.thread.upsert({
    where: {
      userId_source_sourceThreadId: {
        userId,
        source: "imessage",
        sourceThreadId,
      },
    },
    create: {
      userId,
      source: "imessage",
      sourceThreadId,
      isGroup: group.isGroupChat,
      displayName: group.chatName,
      lastActivityAt: new Date(),
    },
    update: {
      isGroup: group.isGroupChat,
      lastActivityAt: new Date(),
      ...(group.chatName ? { displayName: group.chatName } : {}),
    },
  });

  // Upsert participants
  for (const contactId of contactIds) {
    try {
      await prisma.threadParticipant.upsert({
        where: {
          threadId_contactId: { threadId: thread.id, contactId },
        },
        create: { threadId: thread.id, contactId },
        update: {},
      });
    } catch {
      // Contact may not exist — skip
    }
  }

  return { id: thread.id };
}

// ─── Bulk chatId correction ─────────────────────────────────
// Look up iMessage interaction GUIDs in chat.db and fix mismatches.
// Catches messages misattributed by old per-handle sync AND messages
// with text=NULL in chat.db (content in attributedBody).

async function correctChatIds(
  userId: string,
  chatGroups: ReadonlyArray<ChatGroup>,
  days: number,
): Promise<number> {
  // Build rawRowId → canonical chatId map
  const rawToCanonical = new Map<number, string>();
  for (const group of chatGroups) {
    for (const rc of group.members) {
      rawToCanonical.set(rc.chat.chatRowId, group.chatId);
    }
  }

  const { guidToChat: guidToChatRaw } = await getGuidToChatRaw(days);
  if (guidToChatRaw.size === 0) return 0;

  const daysAgo = new Date(Date.now() - days * 86400000);
  const imsgInteractions = await prisma.interaction.findMany({
    where: {
      userId,
      chatId: { startsWith: "imsg-chat:" },
      occurredAt: { gte: daysAgo },
    },
    select: { id: true, sourceId: true, chatId: true },
  });

  let corrected = 0;
  for (const ix of imsgInteractions) {
    const guid = (ix.sourceId ?? "")
      .replace("imsg-ind:", "")
      .replace("imsg:", "");
    if (!guid) continue;

    const rawRowId = guidToChatRaw.get(guid);
    if (rawRowId === undefined) continue;

    const correctChatId = rawToCanonical.get(rawRowId) ?? `imsg-chat:${rawRowId}`;
    if (ix.chatId !== correctChatId) {
      await prisma.interaction.update({
        where: { id: ix.id },
        data: { chatId: correctChatId },
      });
      corrected++;
    }
  }

  return corrected;
}

// ─── Update lastInteraction timestamps ──────────────────────

async function updateLastInteractions(
  userId: string,
  contactIds: ReadonlySet<string>,
): Promise<void> {
  for (const contactId of contactIds) {
    const latest = await prisma.interaction.findFirst({
      where: { contactId, userId },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    });
    if (latest) {
      await prisma.contact.update({
        where: { id: contactId },
        data: { lastInteraction: latest.occurredAt },
      });
    }
  }
}
