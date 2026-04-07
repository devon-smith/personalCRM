import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { authExtension } from "@/lib/extension-auth";
import { prisma } from "@/lib/prisma";
import { autoResolveOnOutbound } from "@/lib/auto-resolve";
import { onInboundInteraction, onOutboundInteraction } from "@/lib/inbox";
import { findContactByPhone, normalizePhone } from "@/lib/phone-match";

// ─── Types ──────────────────────────────────────────────────

interface WhatsAppSyncBody {
  phone: string;
  displayName: string;
  messages: Array<{
    text: string;
    timestamp: string;
    isFromMe: boolean;
    senderName: string;
    messageId: string;
  }>;
  isGroup: boolean;
  groupName?: string;
  groupId?: string;
}

// ─── Contact matching ───────────────────────────────────────

async function findContact(
  userId: string,
  phone: string,
  displayName: string,
): Promise<{ id: string; name: string } | null> {
  // 1. Phone match (primary + additional)
  const byPhone = await findContactByPhone(userId, phone);
  if (byPhone) return byPhone;

  // 2. Name match: exact (case-insensitive)
  const byName = await prisma.contact.findFirst({
    where: {
      userId,
      name: { equals: displayName, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });
  if (byName) return byName;

  // 3. Aliases match
  const allContacts = await prisma.contact.findMany({
    where: {
      userId,
      OR: [
        { aliases: { isEmpty: false } },
        { nicknames: { isEmpty: false } },
      ],
    },
    select: { id: true, name: true, aliases: true, nicknames: true },
  });

  const lowerName = displayName.toLowerCase();
  for (const c of allContacts) {
    if (c.aliases.some((a) => a.toLowerCase() === lowerName)) {
      return { id: c.id, name: c.name };
    }
    if (c.nicknames.some((n) => n.toLowerCase() === lowerName)) {
      return { id: c.id, name: c.name };
    }
  }

  return null;
}

// ─── POST handler ───────────────────────────────────────────

/**
 * POST /api/whatsapp/sync
 * Receives WhatsApp messages from the Baileys sidecar.
 */
export async function POST(request: Request) {
  try {
    const authResult = await authExtension(request);
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.userId;

    const body = (await request.json()) as WhatsAppSyncBody;

    if (!body.phone || !body.messages?.length) {
      return NextResponse.json(
        { error: "phone and messages are required" },
        { status: 400 },
      );
    }

    const normalized = normalizePhone(body.phone);
    const contact = await findContact(userId, body.phone, body.displayName);

    // No match → create a ContactSighting for review queue
    if (!contact) {
      await prisma.contactSighting.upsert({
        where: {
          userId_source_externalId: {
            userId,
            source: "WHATSAPP",
            externalId: normalized,
          },
        },
        create: {
          userId,
          source: "WHATSAPP",
          externalId: normalized,
          name: body.displayName,
          phone: body.phone,
          resolution: "PENDING",
        },
        update: {
          name: body.displayName,
          seenAt: new Date(),
        },
      });

      // Track unmatched chat in sync state
      await updateSyncState(userId, body.phone, {
        synced: 0,
        matched: false,
        unmatchedPhone: normalized,
        unmatchedName: body.displayName,
        unmatchedCount: body.messages.length,
      });

      return NextResponse.json({
        synced: 0,
        skipped: body.messages.length,
        unmatched: true,
        displayName: body.displayName,
      });
    }

    // Build chatId
    const chatId = body.isGroup
      ? `whatsapp:group:${body.groupId ?? normalized}`
      : `whatsapp:1:1:${contact.id}`;

    // Upsert Thread
    const sourceThreadId = body.isGroup
      ? (body.groupId ?? normalized)
      : contact.id;

    const thread = await prisma.thread.upsert({
      where: {
        userId_source_sourceThreadId: {
          userId,
          source: "whatsapp",
          sourceThreadId,
        },
      },
      create: {
        userId,
        source: "whatsapp",
        sourceThreadId,
        isGroup: body.isGroup,
        displayName: body.isGroup ? (body.groupName ?? "Group") : contact.name,
        lastActivityAt: new Date(),
      },
      update: {
        lastActivityAt: new Date(),
      },
    });

    await prisma.threadParticipant
      .upsert({
        where: {
          threadId_contactId: { threadId: thread.id, contactId: contact.id },
        },
        create: { threadId: thread.id, contactId: contact.id },
        update: {},
      })
      .catch(() => {});

    // Create interactions, dedup by sourceId
    let synced = 0;
    let skipped = 0;
    const threadKey = chatId;

    for (const msg of body.messages) {
      const sourceId = `wa-msg:${msg.messageId}`;
      const timestamp = new Date(msg.timestamp);

      const existing = await prisma.interaction.findFirst({
        where: { userId, sourceId },
      });

      if (existing) {
        skipped++;
        continue;
      }

      const interaction = await prisma.interaction.create({
        data: {
          userId,
          contactId: contact.id,
          type: "MESSAGE",
          direction: msg.isFromMe ? "OUTBOUND" : "INBOUND",
          channel: "whatsapp",
          summary: msg.text.slice(0, 500),
          occurredAt: timestamp,
          sourceId,
          chatId,
          threadId: thread.id,
          isGroupChat: body.isGroup,
          chatName: body.isGroup ? body.groupName : null,
        },
      });

      // Feed into inbox pipeline
      if (msg.isFromMe) {
        await onOutboundInteraction(userId, contact.id, "whatsapp", timestamp, {
          threadKey,
          isGroupChat: body.isGroup,
        });
      } else {
        await onInboundInteraction(
          userId,
          contact.id,
          "whatsapp",
          {
            id: interaction.id,
            summary: interaction.summary,
            occurredAt: timestamp,
            subject: null,
          },
          {
            threadKey,
            isGroupChat: body.isGroup,
          },
        );
      }

      synced++;
    }

    // Update lastInteraction
    if (synced > 0) {
      const latest = await prisma.interaction.findFirst({
        where: { contactId: contact.id, userId },
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true },
      });
      if (latest) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { lastInteraction: latest.occurredAt },
        });
      }
    }

    // Auto-resolve action items for latest outbound
    const latestOutbound = body.messages
      .filter((m) => m.isFromMe)
      .map((m) => new Date(m.timestamp))
      .sort((a, b) => b.getTime() - a.getTime())[0];

    if (latestOutbound) {
      await autoResolveOnOutbound(
        userId,
        contact.id,
        "whatsapp",
        latestOutbound,
      );
    }

    // Update sync state
    const latestTimestamp = body.messages
      .map((m) => new Date(m.timestamp))
      .sort((a, b) => b.getTime() - a.getTime())[0];

    await updateSyncState(userId, body.phone, {
      synced,
      matched: true,
      lastMessageAt: latestTimestamp,
    });

    return NextResponse.json({
      synced,
      skipped,
      contactName: contact.name,
    });
  } catch (error) {
    console.error("[POST /api/whatsapp/sync]", error);
    return NextResponse.json(
      { error: "Failed to sync WhatsApp messages" },
      { status: 500 },
    );
  }
}

// ─── Sync state tracking ────────────────────────────────────

interface UnmatchedEntry {
  phone: string;
  displayName: string;
  messageCount: number;
}

function mergeUnmatched(
  existing: UnmatchedEntry[],
  phone: string,
  displayName: string,
  count: number,
): UnmatchedEntry[] {
  const merged = new Map<string, UnmatchedEntry>();
  for (const e of existing) {
    merged.set(e.phone, e);
  }
  const prev = merged.get(phone);
  merged.set(phone, {
    phone,
    displayName,
    messageCount: (prev?.messageCount ?? 0) + count,
  });
  return [...merged.values()]
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 50);
}

async function updateSyncState(
  userId: string,
  sidecarPhone: string,
  update: {
    synced: number;
    matched: boolean;
    lastMessageAt?: Date;
    unmatchedPhone?: string;
    unmatchedName?: string;
    unmatchedCount?: number;
  },
): Promise<void> {
  try {
    const existing = await prisma.whatsAppSyncState.findUnique({
      where: { userId },
    });

    const unmatchedChats = (existing?.unmatchedChats as UnmatchedEntry[] | null) ?? [];
    const newUnmatched =
      !update.matched && update.unmatchedPhone
        ? mergeUnmatched(
            unmatchedChats,
            update.unmatchedPhone,
            update.unmatchedName ?? "",
            update.unmatchedCount ?? 0,
          )
        : unmatchedChats;

    const unmatchedJson = newUnmatched as unknown as Prisma.InputJsonValue;

    await prisma.whatsAppSyncState.upsert({
      where: { userId },
      create: {
        userId,
        phone: sidecarPhone,
        connected: true,
        lastMessageAt: update.lastMessageAt ?? null,
        messagesSynced: update.synced,
        contactsMatched: update.matched ? 1 : 0,
        unmatchedChats: unmatchedJson,
      },
      update: {
        connected: true,
        ...(update.lastMessageAt ? { lastMessageAt: update.lastMessageAt } : {}),
        messagesSynced: { increment: update.synced },
        ...(update.matched ? { contactsMatched: { increment: 1 } } : {}),
        unmatchedChats: unmatchedJson,
      },
    });
  } catch (err) {
    console.error("[whatsapp/sync] Failed to update sync state:", err);
  }
}
