import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getConversations,
  getActiveChats,
  getMessagesForChat,
  getChatParticipants,
  appleTimestampToDate,
  getGuidToChatRaw,
} from "@/lib/imessage";
import { normalizePhone } from "@/lib/name-utils";
import { autoResolveOnOutbound } from "@/lib/auto-resolve";
import { onInboundInteraction, onOutboundInteraction } from "@/lib/inbox";

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

// ─── POST — Sync individual iMessages as Interactions (per-chat) ─

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    // 1. Get all chats with recent messages (iterates by chat, not by handle)
    const { chats, error: chatError } = await getActiveChats(60);
    if (chatError) {
      return NextResponse.json({ error: chatError }, { status: 500 });
    }

    // 2. Load contacts for handle → contactId matching
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

    // Load sync states for handle → contactId reverse lookup
    const syncStates = await prisma.iMessageSyncState.findMany({
      where: { userId },
    });
    const handleToContact = new Map<string, string>();
    for (const s of syncStates) {
      if (s.contactId) {
        handleToContact.set(s.handleId, s.contactId);
      }
    }

    // 3. Get existing iMessage sourceIds to skip duplicates
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
    const backfillGuids = new Set(
      backfillRows
        .map((i) => (i.sourceId ?? "").replace("imsg:", ""))
        .filter((g) => g && !g.startsWith("ind:")),
    );

    let messagesCreated = 0;
    let messagesSkipped = 0;
    let chatIdsCorrected = 0;
    let unmatchedChats = 0;
    let chatsMerged = 0;
    const matchedContactIds = new Set<string>();
    const outboundContacts = new Map<string, { channel: string; occurredAt: Date }>();
    const errors: string[] = [];

    // 4. Pre-resolve all chats' participants → contacts, then group by contact set
    //    Apple creates multiple chat ROWIDs for the same conversation when services
    //    switch (iMessage ↔ SMS). These have different group_ids but the same
    //    participants (just different phone numbers for the same contact).
    //    By resolving handles to contacts FIRST, we can detect and merge these.
    interface ResolvedChat {
      chat: typeof chats[number];
      participants: { handleId: string; service: string }[];
      handleToContact: Map<string, string>;
      contactIds: Set<string>;
      defaultContactId: string;
    }

    const resolvedChats: ResolvedChat[] = [];
    for (const chat of chats) {
      const { participants, error: partError } = await getChatParticipants(chat.chatRowId);
      if (partError) {
        errors.push(`chat ${chat.chatRowId}: ${partError}`);
        continue;
      }

      const chatHandleToContact = new Map<string, string>();
      const contactIds = new Set<string>();

      for (const p of participants) {
        const cId = resolveHandleToContact(p.handleId, byPhone, byEmail, handleToContact);
        if (cId) {
          chatHandleToContact.set(p.handleId, cId);
          contactIds.add(cId);
        }
      }

      if (contactIds.size === 0) {
        unmatchedChats++;
        continue;
      }

      resolvedChats.push({
        chat,
        participants,
        handleToContact: chatHandleToContact,
        contactIds,
        defaultContactId: [...contactIds][0],
      });
    }

    // Group chats by their resolved contact set — same contacts = same conversation
    // Key: sorted contactIds joined by ","
    const chatGroups = new Map<string, ResolvedChat[]>();
    for (const rc of resolvedChats) {
      const key = [...rc.contactIds].sort().join(",");
      const group = chatGroups.get(key) ?? [];
      group.push(rc);
      chatGroups.set(key, group);
    }

    // 5. Process each chat group (merged Apple duplicates)
    for (const [, group] of chatGroups) {
      // Pick canonical chat: the ROWID with the most recent messages
      const canonical = group.reduce((best, rc) =>
        rc.chat.recentMessageCount > best.chat.recentMessageCount ? rc : best,
      );
      const chatId = `imsg-chat:${canonical.chat.chatRowId}`;
      const isGroupChat = canonical.chat.isGroupChat || group.length > 1;
      const chatName = canonical.chat.chatName
        ?? group.find((rc) => rc.chat.chatName)?.chat.chatName
        ?? null;

      if (group.length > 1) {
        chatsMerged += group.length - 1;
      }

      // Merge handle→contact maps from all ROWIDs in this group
      const mergedHandleToContact = new Map<string, string>();
      for (const rc of group) {
        for (const [h, c] of rc.handleToContact) {
          mergedHandleToContact.set(h, c);
        }
      }
      const defaultContactId = canonical.defaultContactId;

      // Process messages from ALL ROWIDs in this group under the canonical chatId
      for (const rc of group) {
        const { messages, error: msgError } = await getMessagesForChat(rc.chat.chatRowId, 60);
        if (msgError) {
          errors.push(`chat ${rc.chat.chatRowId}: ${msgError}`);
          continue;
        }

        const channelLabel = rc.chat.serviceName === "SMS" ? "SMS" : "iMessage";

        for (const msg of messages) {
          const sourceId = `imsg-ind:${msg.guid}`;

          // Check corrections BEFORE text filter — messages may have text=NULL
          // in chat.db but exist in our DB from the old per-handle sync
          if (existingSourceIds.has(sourceId) || backfillGuids.has(msg.guid)) {
            const lookupId = existingSourceIds.has(sourceId) ? sourceId : `imsg:${msg.guid}`;
            const existing = await prisma.interaction.findFirst({
              where: { userId, sourceId: lookupId },
              select: { id: true, chatId: true, contactId: true },
            });
            if (existing && existing.chatId !== chatId) {
              const correctedContactId = msg.isFromMe
                ? defaultContactId
                : (msg.senderHandle
                    ? (mergedHandleToContact.get(msg.senderHandle)
                      ?? resolveHandleToContact(msg.senderHandle, byPhone, byEmail, handleToContact))
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
              chatIdsCorrected++;
            }
            messagesSkipped++;
            continue;
          }

          // Skip messages with no text for new creation (after correction check above)
          if (!msg.text || msg.text.trim().length === 0) continue;

          // Resolve contactId from the actual sender handle
          const contactId = msg.isFromMe
            ? defaultContactId
            : (msg.senderHandle
                ? (mergedHandleToContact.get(msg.senderHandle)
                  ?? resolveHandleToContact(msg.senderHandle, byPhone, byEmail, handleToContact))
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

          let createdIx;
          try {
            createdIx = await prisma.interaction.create({
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
              },
            });
          } catch (e: unknown) {
            // Unique constraint violation from concurrent sync — skip
            if (e instanceof Error && e.message.includes("Unique constraint")) {
              messagesSkipped++;
              existingSourceIds.add(sourceId);
              continue;
            }
            throw e;
          }

          // Feed into persistent inbox system
          if (direction === "INBOUND") {
            await onInboundInteraction(userId, contactId, channelLabel, {
              id: createdIx.id,
              summary,
              occurredAt,
              subject,
            }, {
              threadKey: isGroupChat ? (chatName ?? "group") : undefined,
              isGroupChat,
            });
          } else {
            await onOutboundInteraction(userId, contactId, channelLabel, occurredAt, {
              threadKey: isGroupChat ? (chatName ?? "group") : undefined,
              isGroupChat,
            });
          }

          existingSourceIds.add(sourceId);
          messagesCreated++;

          if (direction === "OUTBOUND") {
            const prev = outboundContacts.get(contactId);
            if (!prev || occurredAt > prev.occurredAt) {
              outboundContacts.set(contactId, { channel: channelLabel, occurredAt });
            }
          }
        }
      }

      // Update sync states for all participants across all ROWIDs in this group
      for (const rc of group) {
        for (const p of rc.participants) {
          const contactId = mergedHandleToContact.get(p.handleId);
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

    // 5. Bulk chatId correction: look up EVERY iMessage interaction's GUID
    //    in chat.db and fix any chatId mismatches. This catches messages that
    //    were misattributed by the old per-handle sync AND messages in chats
    //    with text=NULL in chat.db (content in attributedBody).
    //
    //    Build rawRowId → canonical chatId map from the contact-set groups
    const rawToCanonical = new Map<number, string>();
    for (const [, group] of chatGroups) {
      const canonical = group.reduce((best, rc) =>
        rc.chat.recentMessageCount > best.chat.recentMessageCount ? rc : best,
      );
      const canonChatId = `imsg-chat:${canonical.chat.chatRowId}`;
      for (const rc of group) {
        rawToCanonical.set(rc.chat.chatRowId, canonChatId);
      }
    }

    const { guidToChat: guidToChatRaw } = await getGuidToChatRaw(90);

    if (guidToChatRaw.size > 0) {
      // Query all iMessage interactions that might need correction
      const imsgInteractions = await prisma.interaction.findMany({
        where: {
          userId,
          chatId: { startsWith: "imsg-chat:" },
        },
        select: { id: true, sourceId: true, chatId: true },
      });

      for (const ix of imsgInteractions) {
        // Extract GUID from sourceId: "imsg-ind:GUID" or "imsg:GUID"
        const guid = (ix.sourceId ?? "")
          .replace("imsg-ind:", "")
          .replace("imsg:", "");
        if (!guid) continue;

        const rawRowId = guidToChatRaw.get(guid);
        if (rawRowId === undefined) continue;

        // Map raw ROWID to canonical chatId (via contact-set merge)
        const correctChatId = rawToCanonical.get(rawRowId) ?? `imsg-chat:${rawRowId}`;

        if (ix.chatId !== correctChatId) {
          await prisma.interaction.update({
            where: { id: ix.id },
            data: { chatId: correctChatId },
          });
          chatIdsCorrected++;
        }
      }
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

    const result: IMessageSyncResult = {
      chatsScanned: chats.length,
      chatsMerged,
      messagesCreated,
      messagesSkipped,
      chatIdsCorrected,
      contactsMatched: matchedContactIds.size,
      unmatchedChats,
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

// ─── Helpers ─────────────────────────────────────────────────

/** Resolve a handle (phone/email) to a contactId via phone, email, or sync state lookup */
function resolveHandleToContact(
  handleId: string,
  byPhone: Map<string, string>,
  byEmail: Map<string, string>,
  handleToContact: Map<string, string>,
): string | undefined {
  if (handleId.includes("@")) {
    return byEmail.get(handleId.toLowerCase());
  }

  const normalized = normalizePhone(handleId);
  let contactId = byPhone.get(normalized);

  // Suffix match for numbers without country code
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

  // Fallback: previously-matched sync state
  return contactId ?? handleToContact.get(handleId);
}
