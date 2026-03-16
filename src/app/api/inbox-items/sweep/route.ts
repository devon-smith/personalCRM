import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/inbox-items/sweep
 *
 * Retroactive sweep: for every OPEN/SNOOZED InboxItem, check if there's
 * an OUTBOUND interaction AFTER triggerAt for the same contact.
 *
 * Thread-aware: for group chats, checks if the outbound is in the same
 * group chat (by matching the interaction's subject to the threadKey).
 * For 1:1 items, any outbound on the same channel resolves.
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
        threadKey: true,
        isGroupChat: true,
        triggerAt: true,
        status: true,
      },
    });

    if (openItems.length === 0) {
      return NextResponse.json({ resolved: 0, checked: 0 });
    }

    const normalizeChannel = (ch: string) => {
      const c = ch.toLowerCase();
      if (["imessage", "sms", "text"].includes(c)) return "text";
      if (["gmail", "email"].includes(c)) return "email";
      return c;
    };

    const itemsToResolve: string[] = [];

    // 2. For each open item, check for a matching outbound
    for (const item of openItems) {
      // For group chats: look for outbound in the same group (subject matches threadKey)
      // For 1:1: look for any outbound on the same channel
      const outbound = await prisma.interaction.findFirst({
        where: {
          userId,
          contactId: item.contactId,
          direction: "OUTBOUND",
          type: { not: "NOTE" },
          occurredAt: { gt: item.triggerAt },
          // For group chats, match by subject (which stores the group chat name)
          ...(item.isGroupChat && item.threadKey
            ? { subject: item.threadKey }
            : {}),
        },
        orderBy: { occurredAt: "desc" },
        select: { channel: true, occurredAt: true },
      });

      if (!outbound) continue;

      const outChannel = outbound.channel?.toLowerCase() ?? "";
      const isCrossChannel =
        outChannel === "meeting" ||
        outChannel === "calendar" ||
        outChannel === "phone" ||
        outChannel === "call";
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
