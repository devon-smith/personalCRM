import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const interactions = await prisma.interaction.findMany({
      where: {
        userId: session.user.id,
        sourceId: { not: { startsWith: "manual-reply:" } },
      },
      orderBy: { occurredAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        direction: true,
        channel: true,
        subject: true,
        summary: true,
        occurredAt: true,
        contact: {
          select: {
            id: true,
            name: true,
            company: true,
            tier: true,
          },
        },
      },
    });

    const items = interactions.map((ix) => ({
      id: ix.id,
      type: ix.type,
      direction: ix.direction,
      channel: ix.channel,
      subject: ix.subject,
      summary: ix.summary,
      occurredAt: ix.occurredAt.toISOString(),
      contactId: ix.contact.id,
      contactName: ix.contact.name,
      contactCompany: ix.contact.company,
    }));

    return NextResponse.json({ items });
  } catch (error) {
    console.error("[GET /api/activity]", error);
    return NextResponse.json(
      { error: "Failed to fetch activity" },
      { status: 500 },
    );
  }
}
