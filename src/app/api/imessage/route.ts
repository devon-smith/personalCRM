import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getConversations, getMessagesForHandle, getChatLookup } from "@/lib/imessage";
import { normalizePhone } from "@/lib/name-utils";
import { autoResolveOnOutbound } from "@/lib/auto-resolve";
import { onInboundInteraction, onOutboundInteraction } from "@/lib/inbox";

// ─── Types ───────────────────────────────────────────────────

export interface IMessageSyncResult {
  readonly handlesScanned: number;
  readonly messagesCreated: number;
  readonly messagesSkipped: number;
  readonly subjectsBackfilled: number;
  readonly contactsMatched: number;
  readonly errors: readonly string[];
}

// ─── GET — Preview iMessage conversations ────────────────────

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await getConversations(60);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      conversations: result.conversations,
      total: result.total,
    });
  } catch (error) {
    console.error("iMessage read error:", error);
    return NextResponse.json(
      { error: "Failed to read iMessages" },
      { status: 500 },
    );
  }
}

// ─── POST — Sync individual iMessages as Interactions ────────

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    // 1. Get all conversations from last 14 days
    const { conversations, error: convError } = await getConversations(60);
    if (convError) {
      return NextResponse.json({ error: convError }, { status: 500 });
    }

    // 1b. Load canonical ROWID map for chat deduplication
    const { canonicalRowId } = await getChatLookup();

    // 2. Load contacts for matching
    const contacts = await prisma.contact.findMany({
      where: { userId },
      select: { id: true, phone: true, email: true, additionalEmails: true },
    });

    const byPhone = new Map<string, string>();
    const byEmail = new Map<string, string>();

    for (const c of contacts) {
      if (c.phone) {
        byPhone.set(normalizePhone(c.phone), c.id);
      }
      if (c.email) {
        byEmail.set(c.email.toLowerCase(), c.id);
      }
      for (const extra of c.additionalEmails) {
        byEmail.set(extra.toLowerCase(), c.id);
      }
    }

    // 3. Load existing sync states for this user
    const syncStates = await prisma.iMessageSyncState.findMany({
      where: { userId },
    });
    const syncStateMap = new Map(syncStates.map((s) => [s.handleId, s]));

    // Build reverse map: handleId → contactId from previously-matched sync states
    // This lets us find contacts even when their phone/email format doesn't match the handle
    const handleToContact = new Map<string, string>();
    for (const s of syncStates) {
      if (s.contactId) {
        handleToContact.set(s.handleId, s.contactId);
      }
    }

    // 4. Get existing iMessage sourceIds to skip duplicates
    //    Check both formats: "imsg-ind:{guid}" (regular sync) and "imsg:{guid}" (backfill)
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
    const existingSourceIds = new Set(indRows.map((i) => i.sourceId));
    // Also track backfill GUIDs so we don't re-create them
    const backfillGuids = new Set(
      backfillRows
        .map((i) => (i.sourceId ?? "").replace("imsg:", ""))
        .filter((g) => g && !g.startsWith("ind:")),
    );

    let messagesCreated = 0;
    let messagesSkipped = 0;
    let subjectsBackfilled = 0;
    const matchedContactIds = new Set<string>();
    // Track contacts with outbound messages for auto-resolve
    const outboundContacts = new Map<string, { channel: string; occurredAt: Date }>();
    const errors: string[] = [];

    // Generic subjects that should be backfilled with real group chat names
    const GENERIC_SUBJECT_RE = /^(iMessage|SMS|Email|Group)\s*(message)?$/i;

    // 5. Process each conversation handle
    for (const conv of conversations) {
      const handleId = conv.handleId;

      // Match handle to contact
      let contactId: string | undefined;
      if (handleId.includes("@")) {
        contactId = byEmail.get(handleId.toLowerCase());
      } else {
        const normalized = normalizePhone(handleId);
        contactId = byPhone.get(normalized);
        // Try suffix match for numbers without country code
        if (!contactId) {
          const digits = normalized.replace(/\D/g, "");
          const last10 = digits.slice(-10);
          for (const [storedPhone, id] of byPhone) {
            const storedDigits = storedPhone.replace(/\D/g, "");
            if (storedDigits.slice(-10) === last10) {
              contactId = id;
              break;
            }
          }
        }
      }

      // Fallback: check if this handle was previously matched to a contact
      if (!contactId) {
        contactId = handleToContact.get(handleId);
      }

      if (!contactId) continue;
      matchedContactIds.add(contactId);

      // Fetch individual messages for this handle (14 days)
      const { messages, error: msgError } = await getMessagesForHandle(
        handleId,
        60,
      );

      if (msgError) {
        errors.push(`${handleId}: ${msgError}`);
        continue;
      }

      let handleMessagesCreated = 0;
      let latestGuid: string | null = null;

      for (const msg of messages) {
        if (!msg.text || msg.text.trim().length === 0) continue;

        // sourceId uses "imsg-ind:" prefix to distinguish from old daily summaries
        const sourceId = `imsg-ind:${msg.guid}`;

        if (existingSourceIds.has(sourceId) || backfillGuids.has(msg.guid)) {
          // Backfill chatId and group chat name on existing messages
          const lookupId = existingSourceIds.has(sourceId)
            ? sourceId
            : `imsg:${msg.guid}`;
          const existing = await prisma.interaction.findFirst({
            where: { userId, sourceId: lookupId },
            select: { id: true, subject: true, chatId: true },
          });
          if (existing) {
            const rawRowId = msg.chatRowId;
            const canonicalRow = rawRowId ? (canonicalRowId.get(rawRowId) ?? rawRowId) : null;
            const backfillChatId = canonicalRow
              ? `imsg-chat:${canonicalRow}`
              : `1:1:${contactId}:text`;
            const updates: Record<string, unknown> = {};
            // Always update chatId to the canonical value from chat.db —
            // the message's actual chat_message_join is the source of truth,
            // not the migrate's per-contact guess.
            if (existing.chatId !== backfillChatId) {
              updates.chatId = backfillChatId;
              updates.isGroupChat = msg.isGroupChat;
              updates.chatName = msg.isGroupChat ? (msg.chatName ?? null) : null;
            }
            if (msg.chatName && (!existing.subject || GENERIC_SUBJECT_RE.test(existing.subject))) {
              updates.subject = msg.chatName;
            }
            if (Object.keys(updates).length > 0) {
              await prisma.interaction.update({
                where: { id: existing.id },
                data: updates,
              });
              if (updates.subject) subjectsBackfilled++;
            }
          }
          messagesSkipped++;
          continue;
        }

        const direction = msg.isFromMe ? "OUTBOUND" : "INBOUND";
        const channelLabel = msg.service === "SMS" ? "SMS" : "iMessage";

        // Build summary — prefix group chat messages for detection
        let summary = msg.text.length > 200
          ? msg.text.slice(0, 200) + "..."
          : msg.text;
        if (msg.isGroupChat) {
          summary = `(in group chat) ${summary}`;
        }

        // Use group chat name as subject when available
        const subject = msg.chatName
          ? msg.chatName
          : msg.isGroupChat
            ? "Group message"
            : `${channelLabel} message`;

        // Stable chat identifier: use canonical iMessage chat ROWID, or synthesize for 1:1
        const rawRow = msg.chatRowId;
        const canonRow = rawRow ? (canonicalRowId.get(rawRow) ?? rawRow) : null;
        const chatId = canonRow
          ? `imsg-chat:${canonRow}`
          : `1:1:${contactId}:text`;

        const createdIx = await prisma.interaction.create({
          data: {
            userId,
            contactId,
            type: "MESSAGE",
            direction,
            channel: channelLabel,
            subject,
            summary,
            occurredAt: msg.date,
            sourceId,
            chatId,
            isGroupChat: msg.isGroupChat,
            chatName: msg.isGroupChat ? (msg.chatName ?? null) : null,
          },
        });

        // Feed into persistent inbox system
        if (direction === "INBOUND") {
          await onInboundInteraction(userId, contactId, channelLabel, {
            id: createdIx.id,
            summary,
            occurredAt: msg.date,
            subject,
          }, {
            threadKey: msg.isGroupChat ? (msg.chatName ?? "group") : undefined,
            isGroupChat: msg.isGroupChat,
          });
        } else {
          await onOutboundInteraction(userId, contactId, channelLabel, msg.date, {
            threadKey: msg.isGroupChat ? (msg.chatName ?? "group") : undefined,
            isGroupChat: msg.isGroupChat,
          });
        }

        existingSourceIds.add(sourceId);
        messagesCreated++;
        handleMessagesCreated++;

        // Track outbound messages for auto-resolve (keep latest per contact)
        if (direction === "OUTBOUND") {
          const existing = outboundContacts.get(contactId);
          if (!existing || msg.date > existing.occurredAt) {
            outboundContacts.set(contactId, { channel: channelLabel, occurredAt: msg.date });
          }
        }

        // Track latest guid for sync state
        if (!latestGuid) latestGuid = msg.guid;
      }

      // Update sync state for this handle (including contactId for reverse lookup)
      await prisma.iMessageSyncState.upsert({
        where: {
          userId_handleId: { userId, handleId },
        },
        create: {
          userId,
          handleId,
          contactId,
          service: conv.service,
          lastMessageGuid: latestGuid ?? syncStateMap.get(handleId)?.lastMessageGuid,
          lastSyncAt: new Date(),
          messageCount: (syncStateMap.get(handleId)?.messageCount ?? 0) + handleMessagesCreated,
        },
        update: {
          contactId,
          lastMessageGuid: latestGuid ?? undefined,
          lastSyncAt: new Date(),
          messageCount: {
            increment: handleMessagesCreated,
          },
        },
      });
    }

    // 6. Update lastInteraction for matched contacts
    for (const contactId of matchedContactIds) {
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

    // 7. Auto-resolve inbox/action items for contacts with outbound messages
    for (const [cId, { channel, occurredAt }] of outboundContacts) {
      await autoResolveOnOutbound(userId, cId, channel, occurredAt);
    }

    if (subjectsBackfilled > 0) {
      console.log(`Backfilled ${subjectsBackfilled} group chat names on existing messages`);
    }

    const result: IMessageSyncResult = {
      handlesScanned: conversations.length,
      messagesCreated,
      messagesSkipped,
      subjectsBackfilled,
      contactsMatched: matchedContactIds.size,
      errors,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("iMessage sync error:", error);
    const message = error instanceof Error ? error.message : "Failed to sync iMessages";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
