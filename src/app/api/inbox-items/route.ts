import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Unsnooze expired items first
    await prisma.inboxItem.updateMany({
      where: {
        userId,
        status: "SNOOZED",
        snoozeUntil: { lte: new Date() },
      },
      data: { status: "OPEN", snoozeUntil: null },
    });

    const items = await prisma.inboxItem.findMany({
      where: {
        userId,
        status: "OPEN",
      },
      orderBy: { triggerAt: "desc" },
      take: 50,
    });

    return NextResponse.json({
      items,
      totalOpen: items.length,
    });
  } catch (error) {
    console.error("[GET /api/inbox-items]", error);
    return NextResponse.json(
      { error: "Failed to fetch inbox" },
      { status: 500 },
    );
  }
}
