import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/extension/follow-ups
 * Returns contacts that are overdue for follow-up.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    // Get contacts with followUpDays set that have LinkedIn URLs
    const contacts = await prisma.contact.findMany({
      where: {
        userId,
        followUpDays: { not: null },
        linkedinUrl: { not: null },
      },
      select: {
        id: true,
        name: true,
        company: true,
        linkedinUrl: true,
        tier: true,
        followUpDays: true,
        lastInteraction: true,
      },
    });

    const now = Date.now();
    const items = contacts
      .map((c) => {
        const daysSince = c.lastInteraction
          ? Math.floor((now - c.lastInteraction.getTime()) / (1000 * 60 * 60 * 24))
          : 999;
        const daysOverdue = daysSince - (c.followUpDays ?? 0);
        return {
          contactId: c.id,
          name: c.name,
          company: c.company,
          linkedinUrl: c.linkedinUrl,
          daysOverdue,
          tier: c.tier,
        };
      })
      .filter((c) => c.daysOverdue > 0)
      .sort((a, b) => b.daysOverdue - a.daysOverdue);

    return NextResponse.json({ items, count: items.length });
  } catch (error) {
    console.error("[GET /api/extension/follow-ups]", error);
    return NextResponse.json(
      { error: "Failed to get follow-ups" },
      { status: 500 },
    );
  }
}
