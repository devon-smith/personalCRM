import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { privateCacheHeaders } from "@/lib/http/cache";
import { prisma } from "@/lib/prisma";

const READ_CACHE_HEADERS = privateCacheHeaders(60, 5 * 60);

export interface CircleStory {
  readonly id: string;
  readonly contactId: string;
  readonly contactName: string;
  readonly avatarUrl: string | null;
  readonly headline: string;
  readonly detail: string | null;
  readonly type: string;
  readonly direction: string;
  readonly occurredAt: string;
}

export interface CircleStoriesResponse {
  readonly circleName: string;
  readonly circleColor: string;
  readonly stories: readonly CircleStory[];
}

function buildHeadline(
  contactName: string,
  type: string,
  direction: string,
): string {
  const firstName = contactName.split(" ")[0];

  switch (type) {
    case "EMAIL":
      return direction === "INBOUND"
        ? `${firstName} emailed you`
        : `You emailed ${firstName}`;
    case "MESSAGE":
      return direction === "INBOUND"
        ? `${firstName} texted you`
        : `You texted ${firstName}`;
    case "MEETING":
      return `Meeting with ${firstName}`;
    case "CALL":
      return direction === "INBOUND"
        ? `${firstName} called you`
        : `You called ${firstName}`;
    case "NOTE":
      return `Note about ${firstName}`;
    default:
      return `Interaction with ${firstName}`;
  }
}

function formatDetail(subject: string | null, summary: string | null): string | null {
  if (subject && summary) {
    return `${subject} — ${summary.slice(0, 120)}`;
  }
  return subject ?? summary?.slice(0, 140) ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const circle = await prisma.circle.findFirst({
      where: { id, userId: session.user.id },
      select: { name: true, color: true },
    });

    if (!circle) {
      return NextResponse.json({ error: "Circle not found" }, { status: 404 });
    }

    // Fetch last 14 days of interactions for these contacts
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const interactions = await prisma.interaction.findMany({
      where: {
        userId: session.user.id,
        occurredAt: { gte: fourteenDaysAgo },
        contact: {
          userId: session.user.id,
          circles: { some: { circleId: id } },
        },
      },
      orderBy: { occurredAt: "desc" },
      take: 30,
      select: {
        id: true,
        contactId: true,
        type: true,
        direction: true,
        subject: true,
        summary: true,
        occurredAt: true,
        contact: {
          select: {
            name: true,
            avatarUrl: true,
          },
        },
      },
    });

    const stories: CircleStory[] = interactions.map((i) => ({
      id: i.id,
      contactId: i.contactId,
      contactName: i.contact.name,
      avatarUrl: i.contact.avatarUrl,
      headline: buildHeadline(i.contact.name, i.type, i.direction),
      detail: formatDetail(i.subject, i.summary),
      type: i.type,
      direction: i.direction,
      occurredAt: i.occurredAt.toISOString(),
    }));

    return NextResponse.json({
      circleName: circle.name,
      circleColor: circle.color,
      stories,
    } satisfies CircleStoriesResponse, { headers: READ_CACHE_HEADERS });
  } catch (error) {
    console.error("[GET /api/circles/[id]/stories]", error);
    return NextResponse.json(
      { error: "Failed to load stories" },
      { status: 500 },
    );
  }
}
