import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { contactId } = await params;
    const { channel } = (await req.json()) as { channel: string };

    if (!channel) {
      return NextResponse.json(
        { error: "channel is required" },
        { status: 400 },
      );
    }

    // Verify contact belongs to user
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, userId: session.user.id },
      select: { id: true },
    });

    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const now = new Date();

    // Create a synthetic outbound interaction to close the conversation.
    // Use MESSAGE type so the needs-response engine sees it as a real reply.
    // Do NOT update contact.lastInteraction — this is a bookkeeping record,
    // not a real interaction, and shouldn't bump the contact in recent activity.
    await prisma.interaction.create({
      data: {
        userId: session.user.id,
        contactId,
        type: "MESSAGE",
        direction: "OUTBOUND",
        channel,
        summary: null,
        occurredAt: now,
        sourceId: `manual-reply:${contactId}:${now.getTime()}`,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/needs-response/[contactId]/replied]", error);
    return NextResponse.json(
      { error: "Failed to mark as replied" },
      { status: 500 },
    );
  }
}
