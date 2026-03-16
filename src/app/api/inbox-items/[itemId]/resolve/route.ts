import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { itemId } = await params;

    const item = await prisma.inboxItem.findFirst({
      where: { id: itemId, userId: session.user.id },
    });

    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    await prisma.inboxItem.update({
      where: { id: itemId },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedBy: "manual",
      },
    });

    // Also create a synthetic outbound interaction so cross-channel
    // resolution and the old system (if still running) also see it
    await prisma.interaction.create({
      data: {
        userId: session.user.id,
        contactId: item.contactId,
        type: "NOTE",
        direction: "OUTBOUND",
        channel: item.channel === "text" ? "iMessage" : item.channel,
        summary: "Replied (marked manually)",
        occurredAt: new Date(),
        sourceId: `manual-reply:${item.contactId}:${Date.now()}`,
      },
    });

    console.log(`[inbox] Manually resolved item ${itemId} for contact ${item.contactId} on ${item.channel}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/inbox-items/[itemId]/resolve]", error);
    return NextResponse.json(
      { error: "Failed to resolve item" },
      { status: 500 },
    );
  }
}
