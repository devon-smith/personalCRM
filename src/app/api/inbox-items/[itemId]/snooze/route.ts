import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invalidateInboxCache } from "@/app/api/inbox-items/route";

/**
 * POST /api/inbox-items/:itemId/snooze
 * Snooze an inbox item for a specified number of hours.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { itemId } = await params;
    const { hours } = (await req.json()) as { hours: number };

    if (!hours || hours < 1) {
      return NextResponse.json({ error: "hours is required" }, { status: 400 });
    }

    const snoozeUntil = new Date(Date.now() + hours * 60 * 60 * 1000);

    await prisma.inboxItem.update({
      where: { id: itemId, userId: session.user.id },
      data: {
        status: "SNOOZED",
        snoozeUntil,
      },
    });

    invalidateInboxCache();
    return NextResponse.json({ ok: true, snoozeUntil: snoozeUntil.toISOString() });
  } catch (error) {
    console.error("[POST /api/inbox-items/[itemId]/snooze]", error);
    return NextResponse.json(
      { error: "Failed to snooze item" },
      { status: 500 },
    );
  }
}
