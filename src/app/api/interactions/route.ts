import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { autoResolveOnOutbound } from "@/lib/auto-resolve";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { contactId, type, direction, subject, summary, channel } = body;

  if (!contactId || !type || !direction) {
    return NextResponse.json(
      { error: "contactId, type, and direction are required" },
      { status: 400 }
    );
  }

  // Verify contact ownership
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId: session.user.id },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const now = new Date();

  const interaction = await prisma.interaction.create({
    data: {
      userId: session.user.id,
      contactId,
      type,
      direction,
      subject: subject?.trim() || null,
      summary: summary?.trim() || null,
      channel: channel?.trim() || null,
      occurredAt: now,
    },
  });

  // Update contact's lastInteraction
  await prisma.contact.update({
    where: { id: contactId },
    data: { lastInteraction: now },
  });

  // Auto-resolve inbox/action items for outbound interactions
  if (direction === "OUTBOUND" && channel) {
    await autoResolveOnOutbound(session.user.id, contactId, channel, now);
  }

  return NextResponse.json(interaction, { status: 201 });
}
