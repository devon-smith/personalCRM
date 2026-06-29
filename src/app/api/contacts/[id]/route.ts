import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contactListSelect } from "@/lib/contact-list-query";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const scope = _req.nextUrl.searchParams.get("scope");
  const summaryOnly = scope === "summary";
  const replyContextOnly = scope === "reply-context";

  if (summaryOnly) {
    const contact = await prisma.contact.findFirst({
      where: { id, userId: session.user.id },
      select: contactListSelect,
    });

    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    return NextResponse.json(contact);
  }

  if (replyContextOnly) {
    const contact = await prisma.contact.findFirst({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        company: true,
        role: true,
        tier: true,
        lastInteraction: true,
        circles: {
          take: 1,
          select: {
            circle: { select: { id: true, name: true, color: true } },
          },
        },
        interactions: {
          orderBy: { occurredAt: "desc" },
          take: 5,
          select: {
            id: true,
            type: true,
            channel: true,
            subject: true,
            summary: true,
            occurredAt: true,
          },
        },
        personFacts: {
          where: { dismissedAt: null },
          orderBy: [{ confirmedByUser: "desc" }, { observedAt: "desc" }],
          take: 8,
          select: {
            id: true,
            type: true,
            value: true,
            confidence: true,
            sourceSystem: true,
            observedAt: true,
            confirmedByUser: true,
          },
        },
        profile: {
          select: {
            expertiseAreas: true,
            relationshipStage: true,
            communicationStyle: true,
            geographicContext: true,
            personalitySignals: true,
          },
        },
        memory: {
          select: {
            discussedTopics: true,
            theyMentioned: true,
            openThreads: true,
            personalContext: true,
            recurringThemes: true,
          },
        },
      },
    });

    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    return NextResponse.json(contact);
  }

  const contact = await prisma.contact.findFirst({
    where: { id, userId: session.user.id },
    include: {
      interactions: {
        orderBy: { occurredAt: "desc" },
        take: 50,
      },
      circles: {
        select: {
          circle: { select: { id: true, name: true, color: true } },
        },
      },
      personFacts: {
        where: { dismissedAt: null },
        orderBy: [{ confirmedByUser: "desc" }, { observedAt: "desc" }],
        take: 8,
      },
      profile: true,
      memory: true,
    },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  return NextResponse.json(contact);
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  // Verify ownership
  const existing = await prisma.contact.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const allowedFields = [
    "name", "email", "additionalEmails", "phone", "additionalPhones",
    "company", "role", "tier", "tags", "aliases", "nicknames",
    "linkedinUrl", "city", "state", "country",
    "latitude", "longitude", "notes", "followUpDays", "avatarUrl",
    "birthday", "howWeMet",
  ] as const;

  const data: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) {
      data[field] = body[field];
    }
  }

  const contact = await prisma.contact.update({
    where: { id },
    data,
  });

  return NextResponse.json(contact);
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await prisma.contact.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  await prisma.contact.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
