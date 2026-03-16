import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { onInboundInteraction, onOutboundInteraction } from "@/lib/inbox";

/**
 * POST /api/inbox-items/migrate
 * One-time migration: scan existing interactions and populate InboxItem table.
 * Clears all existing InboxItems first, then replays interactions chronologically.
 * Deduplicates imsg:/imsg-ind: interactions and filters self-contact.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Clear existing inbox items for a clean slate
    await prisma.inboxItem.deleteMany({ where: { userId } });

    // Find self-contact (contact whose email matches the user's email)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    let selfContactIds = new Set<string>();
    if (user?.email) {
      const selfContacts = await prisma.contact.findMany({
        where: {
          userId,
          OR: [
            { email: user.email },
            { name: user.name ?? "__impossible__" },
          ],
        },
        select: { id: true },
      });
      selfContactIds = new Set(selfContacts.map((c) => c.id));
    }

    // Fetch all interactions from the last 30 days
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const interactions = await prisma.interaction.findMany({
      where: {
        userId,
        occurredAt: { gte: since },
        type: { not: "NOTE" },
        dismissedAt: null,
      },
      orderBy: { occurredAt: "asc" },
      select: {
        id: true,
        contactId: true,
        direction: true,
        channel: true,
        subject: true,
        summary: true,
        occurredAt: true,
        sourceId: true,
      },
    });

    // Deduplicate: collect all imsg-ind: GUIDs first, then filter out imsg: duplicates
    const canonicalGuids = new Set<string>();
    for (const ix of interactions) {
      const sourceId = ix.sourceId ?? "";
      if (sourceId.startsWith("imsg-ind:")) {
        canonicalGuids.add(sourceId.replace("imsg-ind:", ""));
      }
    }

    // Also deduplicate by content: same contact + summary + timestamp (within 1s)
    const seenContent = new Set<string>();
    const deduped = interactions.filter((ix) => {
      const sourceId = ix.sourceId ?? "";

      // Skip imsg: if imsg-ind: exists for the same GUID
      if (sourceId.startsWith("imsg:")) {
        const guid = sourceId.replace("imsg:", "");
        if (canonicalGuids.has(guid)) return false;
      }

      // Content-based dedup: same contact + direction + summary + timestamp
      const ts = Math.floor(ix.occurredAt.getTime() / 1000); // 1-second granularity
      const contentKey = `${ix.contactId}:${ix.direction}:${ts}:${(ix.summary ?? "").slice(0, 50)}`;
      if (seenContent.has(contentKey)) return false;
      seenContent.add(contentKey);

      return true;
    });

    let inboundProcessed = 0;
    let outboundProcessed = 0;
    let skippedSelf = 0;

    for (const ix of deduped) {
      if (!ix.channel) continue;

      // Skip self-contact
      if (selfContactIds.has(ix.contactId)) {
        skippedSelf++;
        continue;
      }

      const isGroupChat = (ix.summary ?? "").startsWith("(in group chat)");
      const threadKey = isGroupChat
        ? (ix.subject && ix.subject !== "Group message" ? ix.subject : "group")
        : undefined;

      if (ix.direction === "OUTBOUND") {
        await onOutboundInteraction(userId, ix.contactId, ix.channel, ix.occurredAt, {
          threadKey,
          isGroupChat,
        });
        outboundProcessed++;
      } else if (ix.direction === "INBOUND") {
        await onInboundInteraction(userId, ix.contactId, ix.channel, {
          id: ix.id,
          summary: ix.summary,
          occurredAt: ix.occurredAt,
          subject: ix.subject,
        }, {
          threadKey,
          isGroupChat,
        });
        inboundProcessed++;
      }
    }

    console.log(
      `[inbox-migrate] Processed ${inboundProcessed} inbound + ${outboundProcessed} outbound ` +
      `(${interactions.length - deduped.length} deduped, ${skippedSelf} self-contact skipped)`
    );

    return NextResponse.json({
      ok: true,
      totalInteractions: deduped.length,
      inboundProcessed,
      outboundProcessed,
      duplicatesRemoved: interactions.length - deduped.length,
      selfContactSkipped: skippedSelf,
    });
  } catch (error) {
    console.error("[POST /api/inbox-items/migrate]", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Migration failed", detail: message },
      { status: 500 },
    );
  }
}
