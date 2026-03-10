import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { suggestTags } from "@/lib/ai";

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
        take: 5,
      },
    },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const tags = await suggestTags(
    {
      name: contact.name,
      company: contact.company,
      role: contact.role,
      tier: contact.tier,
      notes: contact.notes,
    },
    contact.interactions
  );

  return NextResponse.json({ tags });
}
