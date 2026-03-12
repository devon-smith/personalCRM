import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getConversations,
  getDailyConversationSummaries,
} from "@/lib/imessage";
import { normalizePhone } from "@/lib/name-utils";

export interface IMessageSyncResult {
  conversationsScanned: number;
  interactionsLogged: number;
  interactionsExisted: number;
  contactsMatched: number;
}

/** GET — Preview iMessage conversations (how many messages, who with) */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await getConversations(90);

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

/** POST — Sync iMessage conversations as MESSAGE interactions */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    // 1. Get daily conversation summaries (one interaction per day per person)
    const { summaries, error } = await getDailyConversationSummaries(90);

    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }

    // 2. Load all contacts with phone numbers and emails for matching
    const contacts = await prisma.contact.findMany({
      where: { userId },
      select: { id: true, phone: true, email: true },
    });

    // Build lookup maps: normalized phone → contactId, email → contactId
    const byPhone = new Map<string, string>();
    const byEmail = new Map<string, string>();

    for (const c of contacts) {
      if (c.phone) {
        byPhone.set(normalizePhone(c.phone), c.id);
      }
      if (c.email) {
        byEmail.set(c.email.toLowerCase(), c.id);
      }
    }

    // 3. Match handles to contacts and log interactions
    let interactionsLogged = 0;
    let interactionsExisted = 0;
    const matchedContactIds = new Set<string>();

    // Get existing iMessage sourceIds to skip duplicates
    const existingSourceIds = new Set(
      (
        await prisma.interaction.findMany({
          where: { userId, sourceId: { startsWith: "imsg:" } },
          select: { sourceId: true },
        })
      ).map((i) => i.sourceId),
    );

    for (const summary of summaries) {
      // Try to match handle to a contact
      let contactId: string | undefined;

      // Handle could be a phone number or email
      if (summary.handleId.includes("@")) {
        // Email handle
        contactId = byEmail.get(summary.handleId.toLowerCase());
      } else {
        // Phone handle
        const normalized = normalizePhone(summary.handleId);
        contactId = byPhone.get(normalized);

        // Try without country code if no match
        if (!contactId && normalized.startsWith("+1")) {
          const withoutCountry = normalized.slice(2);
          // Check all stored phones for a suffix match
          for (const [storedPhone, id] of byPhone) {
            if (storedPhone.endsWith(withoutCountry)) {
              contactId = id;
              break;
            }
          }
        }
      }

      if (!contactId) continue;

      matchedContactIds.add(contactId);

      // sourceId format: imsg:{handleId}:{date}
      const sourceId = `imsg:${summary.handleId}:${summary.date}`;

      if (existingSourceIds.has(sourceId)) {
        interactionsExisted++;
        continue;
      }

      // Determine direction: more sent than received → OUTBOUND
      const direction =
        summary.sentCount > summary.receivedCount ? "OUTBOUND" : "INBOUND";

      const msgLabel = `${summary.messageCount} message${summary.messageCount !== 1 ? "s" : ""}`;
      const channelLabel =
        summary.service === "SMS" ? "SMS" : "iMessage";

      await prisma.interaction.create({
        data: {
          userId,
          contactId,
          type: "MESSAGE",
          direction,
          channel: channelLabel,
          subject: `${channelLabel} conversation`,
          summary: `${msgLabel} (${summary.sentCount} sent, ${summary.receivedCount} received)`,
          occurredAt: new Date(`${summary.date}T12:00:00`),
          sourceId,
        },
      });

      interactionsLogged++;
    }

    // 4. Update lastInteraction for matched contacts
    if (matchedContactIds.size > 0) {
      for (const contactId of matchedContactIds) {
        const latest = await prisma.interaction.findFirst({
          where: { contactId },
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

    const result: IMessageSyncResult = {
      conversationsScanned: summaries.length,
      interactionsLogged,
      interactionsExisted,
      contactsMatched: matchedContactIds.size,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("iMessage sync error:", error);
    return NextResponse.json(
      { error: "Failed to sync iMessages" },
      { status: 500 },
    );
  }
}
