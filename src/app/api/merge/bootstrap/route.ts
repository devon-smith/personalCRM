import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildDuplicateGroups } from "@/lib/contact-duplicates";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const [contacts, linkedInPendingCount] = await Promise.all([
      prisma.contact.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          company: true,
          role: true,
          source: true,
          tier: true,
          lastInteraction: true,
          createdAt: true,
          _count: { select: { interactions: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.contactSighting.count({
        where: {
          userId,
          source: "LINKEDIN",
          resolution: "REVIEW_NEEDED",
        },
      }),
    ]);

    const groups = buildDuplicateGroups(contacts);

    return NextResponse.json(
      {
        duplicates: {
          groups,
          totalGroups: groups.length,
          totalDuplicates: groups.reduce(
            (sum, group) => sum + group.contacts.length - 1,
            0,
          ),
        },
        linkedInReview: { totalPending: linkedInPendingCount },
      },
      {
        headers: {
          "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
        },
      },
    );
  } catch (error) {
    console.error("[GET /api/merge/bootstrap]", error);
    return NextResponse.json(
      { error: "Failed to load merge data" },
      { status: 500 },
    );
  }
}
