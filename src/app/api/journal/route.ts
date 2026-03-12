import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contactId = req.nextUrl.searchParams.get("contactId");
  if (!contactId) {
    return NextResponse.json({ error: "contactId is required" }, { status: 400 });
  }

  // Verify contact ownership
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId: session.user.id },
    select: { id: true },
  });
  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const entries = await prisma.journalEntry.findMany({
    where: { contactId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { contactId, content, mood } = body;

  if (!contactId || !content?.trim()) {
    return NextResponse.json({ error: "contactId and content are required" }, { status: 400 });
  }

  // Verify contact ownership
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId: session.user.id },
    select: { id: true },
  });
  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const validMoods = ["POSITIVE", "NEUTRAL", "CONCERN"];
  const entry = await prisma.journalEntry.create({
    data: {
      contactId,
      userId: session.user.id,
      content: content.trim(),
      mood: validMoods.includes(mood) ? mood : "NEUTRAL",
    },
  });

  return NextResponse.json(entry, { status: 201 });
}
