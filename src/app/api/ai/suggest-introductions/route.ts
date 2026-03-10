import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { suggestIntroductions } from "@/lib/ai-insights";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contacts = await prisma.contact.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      name: true,
      company: true,
      role: true,
      tier: true,
      tags: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });

  if (contacts.length < 2) {
    return NextResponse.json({
      introductions: [],
      message: "Need at least 2 contacts for introduction suggestions.",
    });
  }

  const introductions = await suggestIntroductions(contacts);

  return NextResponse.json({ introductions });
}
