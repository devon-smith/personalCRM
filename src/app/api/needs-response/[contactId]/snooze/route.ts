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
    const { hours } = (await req.json()) as { hours: number };

    if (!hours || hours < 1 || hours > 720) {
      return NextResponse.json(
        { error: "hours must be between 1 and 720" },
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

    const until = new Date(Date.now() + hours * 60 * 60 * 1000);

    await prisma.snoozedContact.upsert({
      where: {
        userId_contactId: {
          userId: session.user.id,
          contactId,
        },
      },
      create: {
        userId: session.user.id,
        contactId,
        until,
      },
      update: {
        until,
      },
    });

    return NextResponse.json({ ok: true, snoozedUntil: until.toISOString() });
  } catch (error) {
    console.error("[POST /api/needs-response/[contactId]/snooze]", error);
    return NextResponse.json(
      { error: "Failed to snooze" },
      { status: 500 },
    );
  }
}
