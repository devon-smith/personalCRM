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

    // Find self-contact IDs to exclude
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    const selfContactIds: string[] = [];
    if (user?.email || user?.name) {
      const selfContacts = await prisma.contact.findMany({
        where: {
          userId,
          OR: [
            ...(user.email ? [{ email: user.email }] : []),
            ...(user.name ? [{ name: user.name }] : []),
          ],
        },
        select: { id: true },
      });
      selfContactIds.push(...selfContacts.map((c) => c.id));
    }

    const items = await prisma.inboxItem.findMany({
      where: {
        userId,
        status: "OPEN",
        ...(selfContactIds.length > 0
          ? { contactId: { notIn: selfContactIds } }
          : {}),
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
