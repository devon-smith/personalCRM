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
    // Group chat optimization: once we find an outbound for a threadKey,
    // resolve ALL items in that thread (not just the one contact)
    const resolvedThreads = new Set<string>();

    for (const item of openItems) {
      // Skip if this group thread was already resolved by a previous item check
      if (item.isGroupChat && item.threadKey && resolvedThreads.has(item.threadKey)) {
        itemsToResolve.push(item.id);
        continue;
      }

      // For group chats: look for outbound in the same group (subject matches threadKey)
      // Don't filter by contactId — outbound may be stored under any group member
      // For 1:1: look for outbound from this specific contact
      const outbound = await prisma.interaction.findFirst({
        where: {
          userId,
          ...(item.isGroupChat
            ? { subject: item.threadKey }       // group: match by thread name, any contact
            : { contactId: item.contactId }),   // 1:1: match by contact
          direction: "OUTBOUND",
          type: { not: "NOTE" },
          occurredAt: { gt: item.triggerAt },
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
        // Mark this group thread as resolved so other members get resolved too
        if (item.isGroupChat && item.threadKey) {
          resolvedThreads.add(item.threadKey);
        }
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
