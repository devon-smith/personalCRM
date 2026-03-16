import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/inbox-items/sweep
 *
 * Retroactive sweep: for every OPEN/SNOOZED InboxItem, check if there's
 * an OUTBOUND interaction AFTER triggerAt for the same contact.
 * If yes → resolve as "auto_sweep".
 *
 * This catches all failure modes:
 * - Gmail CC/BCC replies not firing onOutboundInteraction
 * - iMessage/iCloud sync lag (replies from iPhone)
 * - Race conditions in 2-min sync intervals
 * - Any missed real-time hooks
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // 1. Get all OPEN and SNOOZED inbox items
    const openItems = await prisma.inboxItem.findMany({
      where: {
        userId,
        status: { in: ["OPEN", "SNOOZED"] },
      },
      select: {
        id: true,
        contactId: true,
        channel: true,
        triggerAt: true,
        status: true,
      },
    });

    if (openItems.length === 0) {
      return NextResponse.json({ resolved: 0, checked: 0 });
    }

    // 2. For each open item, check if there's an outbound AFTER triggerAt
    const itemsToResolve: string[] = [];

    // Batch: get unique contactIds and find their latest outbound
    const contactIds = [...new Set(openItems.map((i) => i.contactId))];

    // Get the latest outbound interaction per contact (excluding NOTEs)
    const latestOutbounds = await prisma.interaction.findMany({
      where: {
        userId,
        contactId: { in: contactIds },
        direction: "OUTBOUND",
        type: { not: "NOTE" },
      },
      orderBy: { occurredAt: "desc" },
      distinct: ["contactId"],
      select: {
        contactId: true,
        channel: true,
        occurredAt: true,
      },
    });

    const outboundByContact = new Map(
      latestOutbounds.map((o) => [o.contactId, o])
    );

    for (const item of openItems) {
      const outbound = outboundByContact.get(item.contactId);
      if (!outbound) continue;

      // Outbound must be AFTER the inbox item's trigger
      if (outbound.occurredAt <= item.triggerAt) continue;

      // Cross-channel: a meeting/call resolves any channel
      const outChannel = outbound.channel?.toLowerCase() ?? "";
      const isCrossChannel =
        outChannel === "meeting" ||
        outChannel === "calendar" ||
        outChannel === "phone" ||
        outChannel === "call";

      // Same-channel check (normalized)
      const normalizeChannel = (ch: string) => {
        const c = ch.toLowerCase();
        if (["imessage", "sms", "text"].includes(c)) return "text";
        if (["gmail", "email"].includes(c)) return "email";
        return c;
      };

      const sameChannel = normalizeChannel(outChannel) === normalizeChannel(item.channel);

      if (sameChannel || isCrossChannel) {
        itemsToResolve.push(item.id);
      }
    }

    // 3. Bulk resolve
    let resolved = 0;
    if (itemsToResolve.length > 0) {
      const result = await prisma.inboxItem.updateMany({
        where: { id: { in: itemsToResolve } },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
          resolvedBy: "auto_sweep",
        },
      });
      resolved = result.count;

      if (resolved > 0) {
        console.log(`[inbox-sweep] Resolved ${resolved} stale item(s)`);
      }
    }

    return NextResponse.json({
      resolved,
      checked: openItems.length,
    });
  } catch (error) {
    console.error("[POST /api/inbox-items/sweep]", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Sweep failed", detail: message },
      { status: 500 },
    );
  }
}
