import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { summarizeInteractions } from "@/lib/ai";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { contactId } = await req.json();

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId: session.user.id },
    include: {
      interactions: {
        orderBy: { occurredAt: "desc" },
        take: 10,
      },
    },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const summary = await summarizeInteractions(contact.name, contact.interactions);

  return NextResponse.json({ summary });
}
