import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { onInboundInteraction, onOutboundInteraction } from "@/lib/inbox";

/**
 * POST /api/inbox-items/migrate
 * One-time migration: scan existing interactions and populate InboxItem table.
 * Safe to run multiple times — idempotent via upsert.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

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
      orderBy: { occurredAt: "asc" }, // Process in chronological order
      select: {
        id: true,
        contactId: true,
        direction: true,
        channel: true,
        subject: true,
        summary: true,
        occurredAt: true,
      },
    });

    let inboundProcessed = 0;
    let outboundProcessed = 0;

    for (const ix of interactions) {
      if (!ix.channel) continue;

      const isGroupChat = (ix.summary ?? "").startsWith("(in group chat)");
      const threadKey = isGroupChat
        ? (ix.subject && ix.subject !== "Group message" ? ix.subject : "group")
        : undefined;

      if (ix.direction === "OUTBOUND") {
        await onOutboundInteraction(userId, ix.contactId, ix.channel, ix.occurredAt);
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

    console.log(`[inbox-migrate] Processed ${inboundProcessed} inbound + ${outboundProcessed} outbound interactions`);

    return NextResponse.json({
      ok: true,
      totalInteractions: interactions.length,
      inboundProcessed,
      outboundProcessed,
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
