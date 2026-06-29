import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildContactPrepSummary } from "@/lib/contact-prep-summary";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { contactId } = await req.json();

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId: session.user.id },
    select: {
      name: true,
      company: true,
      role: true,
      profile: {
        select: {
          expertiseAreas: true,
          relationshipStage: true,
        },
      },
      memory: {
        select: {
          recurringThemes: true,
          openThreads: true,
          theyMentioned: true,
        },
      },
      interactions: {
        orderBy: { occurredAt: "desc" },
        take: 5,
        select: {
          type: true,
          direction: true,
          subject: true,
          summary: true,
          occurredAt: true,
        },
      },
    },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const summary = buildContactPrepSummary({
    name: contact.name,
    company: contact.company,
    role: contact.role,
    profile: contact.profile,
    memory: contact.memory,
    recentInteractions: contact.interactions,
  });

  return NextResponse.json({ summary, source: "local" });
}
