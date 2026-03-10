import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseInteractionText } from "@/lib/ai-parser";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { text, contactId } = await req.json();

  if (!text || !contactId) {
    return NextResponse.json(
      { error: "text and contactId are required" },
      { status: 400 }
    );
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId: session.user.id },
    select: { name: true },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const parsed = await parseInteractionText(text, contact.name);

  return NextResponse.json(parsed);
}
