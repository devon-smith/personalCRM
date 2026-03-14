import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getConversations, getMessagesForHandle } from "@/lib/imessage";
import { normalizePhone } from "@/lib/name-utils";

/**
 * GET /api/imessage/debug
 *
 * Diagnostic endpoint — shows what the sync pipeline sees without writing anything.
 * Use to verify: chat.db access, handle→contact matching, message direction detection.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const url = new URL(request.url);
  const handleFilter = url.searchParams.get("handle"); // optional: test a single handle
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 10), 50);

  try {
    // 1. Read chat.db
    const { conversations, error: convError, total } = await getConversations(14);
    if (convError) {
      return NextResponse.json({ chatDbAccess: false, error: convError });
    }

    // 2. Load contacts
    const contacts = await prisma.contact.findMany({
      where: { userId },
      select: { id: true, name: true, phone: true, email: true, additionalEmails: true },
    });

    const byPhone = new Map<string, { id: string; name: string }>();
    const byEmail = new Map<string, { id: string; name: string }>();

    for (const c of contacts) {
      if (c.phone) {
        byPhone.set(normalizePhone(c.phone), { id: c.id, name: c.name });
      }
      if (c.email) {
        byEmail.set(c.email.toLowerCase(), { id: c.id, name: c.name });
      }
      for (const extra of c.additionalEmails) {
        byEmail.set(extra.toLowerCase(), { id: c.id, name: c.name });
      }
    }

    // 3. Match handles
    const handleResults: Array<{
      handleId: string;
      service: string;
      messageCount: number;
      matchedContact: { id: string; name: string } | null;
      normalizedPhone: string | null;
      recentMessages: Array<{
        guid: string;
        direction: string;
        text: string | null;
        date: string;
      }>;
    }> = [];

    const convsToCheck = handleFilter
      ? conversations.filter((c) => c.handleId.includes(handleFilter))
      : conversations.slice(0, limit);

    for (const conv of convsToCheck) {
      let matched: { id: string; name: string } | null = null;
      let normalizedPhone: string | null = null;

      if (conv.handleId.includes("@")) {
        const found = byEmail.get(conv.handleId.toLowerCase());
        if (found) matched = found;
      } else {
        normalizedPhone = normalizePhone(conv.handleId);
        const found = byPhone.get(normalizedPhone);
        if (found) {
          matched = found;
        } else {
          const digits = normalizedPhone.replace(/\D/g, "");
          const last10 = digits.slice(-10);
          for (const [storedPhone, info] of byPhone) {
            if (storedPhone.replace(/\D/g, "").slice(-10) === last10) {
              matched = info;
              break;
            }
          }
        }
      }

      // Get a few recent messages to show direction
      const { messages } = await getMessagesForHandle(conv.handleId, 14);

      handleResults.push({
        handleId: conv.handleId,
        service: conv.service,
        messageCount: conv.messageCount,
        matchedContact: matched,
        normalizedPhone,
        recentMessages: messages.slice(0, 5).map((m) => ({
          guid: m.guid,
          direction: m.isFromMe ? "OUTBOUND" : "INBOUND",
          text: m.text ? m.text.slice(0, 100) : null,
          date: m.date.toISOString(),
        })),
      });
    }

    // 4. Check what's already synced
    const syncedCount = await prisma.interaction.count({
      where: { userId, sourceId: { startsWith: "imsg-ind:" } },
    });

    const syncStates = await prisma.iMessageSyncState.findMany({
      where: { userId },
      select: { handleId: true, messageCount: true, lastSyncAt: true },
    });

    // 5. Show needs-response status for matched contacts
    const matchedContactIds = handleResults
      .filter((h) => h.matchedContact)
      .map((h) => h.matchedContact!.id);

    const recentInteractions = matchedContactIds.length > 0
      ? await prisma.interaction.findMany({
          where: {
            userId,
            contactId: { in: matchedContactIds },
            channel: { in: ["iMessage", "SMS"] },
          },
          orderBy: { occurredAt: "desc" },
          take: 20,
          select: {
            contactId: true,
            direction: true,
            channel: true,
            summary: true,
            occurredAt: true,
            sourceId: true,
          },
        })
      : [];

    return NextResponse.json({
      chatDbAccess: true,
      totalConversations: total,
      contactsWithPhone: byPhone.size,
      contactsWithEmail: byEmail.size,
      alreadySynced: syncedCount,
      syncStates,
      handles: handleResults,
      recentSyncedInteractions: recentInteractions.map((i) => ({
        contactId: i.contactId,
        direction: i.direction,
        channel: i.channel,
        summary: i.summary?.slice(0, 80),
        occurredAt: i.occurredAt,
        source: i.sourceId?.slice(0, 30),
      })),
    });
  } catch (error) {
    console.error("iMessage debug error:", error);
    const message = error instanceof Error ? error.message : "Debug failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
