import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getConversations, getMessagesForHandle } from "@/lib/imessage";
import { normalizePhone } from "@/lib/name-utils";

// ─── Types ───────────────────────────────────────────────────

export interface IMessageSyncResult {
  readonly handlesScanned: number;
  readonly messagesCreated: number;
  readonly messagesSkipped: number;
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

    // 4. Get existing iMessage sourceIds to skip duplicates
    const existingSourceIds = new Set(
      (
        await prisma.interaction.findMany({
          where: { userId, sourceId: { startsWith: "imsg-ind:" } },
          select: { sourceId: true },
        })
      ).map((i) => i.sourceId),
    );

    let messagesCreated = 0;
    let messagesSkipped = 0;
    const matchedContactIds = new Set<string>();
    const errors: string[] = [];

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

        if (existingSourceIds.has(sourceId)) {
          messagesSkipped++;
          continue;
        }

        const direction = msg.isFromMe ? "OUTBOUND" : "INBOUND";
        const channelLabel = msg.service === "SMS" ? "SMS" : "iMessage";

        // Truncate long messages for summary (keep first 200 chars)
        const summary =
          msg.text.length > 200
            ? msg.text.slice(0, 200) + "..."
            : msg.text;

        await prisma.interaction.create({
          data: {
            userId,
            contactId,
            type: "MESSAGE",
            direction,
            channel: channelLabel,
            subject: `${channelLabel} message`,
            summary,
            occurredAt: msg.date,
            sourceId,
          },
        });

        existingSourceIds.add(sourceId);
        messagesCreated++;
        handleMessagesCreated++;

        // Track latest guid for sync state
        if (!latestGuid) latestGuid = msg.guid;
      }

      // Update sync state for this handle
      await prisma.iMessageSyncState.upsert({
        where: {
          userId_handleId: { userId, handleId },
        },
        create: {
          userId,
          handleId,
          service: conv.service,
          lastMessageGuid: latestGuid ?? syncStateMap.get(handleId)?.lastMessageGuid,
          lastSyncAt: new Date(),
          messageCount: (syncStateMap.get(handleId)?.messageCount ?? 0) + handleMessagesCreated,
        },
        update: {
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

    const result: IMessageSyncResult = {
      handlesScanned: conversations.length,
      messagesCreated,
      messagesSkipped,
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
