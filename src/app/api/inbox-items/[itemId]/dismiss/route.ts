import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invalidateInboxCache } from "@/app/api/inbox-items/route";

/**
 * POST /api/inbox-items/:itemId/dismiss
 * Permanently dismiss an inbox item.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { itemId } = await params;

    await prisma.inboxItem.update({
      where: { id: itemId, userId: session.user.id },
      data: {
        status: "DISMISSED",
        resolvedAt: new Date(),
        resolvedBy: "dismissed",
        snoozeUntil: null,
      },
    });

    invalidateInboxCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/inbox-items/[itemId]/dismiss]", error);
    return NextResponse.json(
      { error: "Failed to dismiss item" },
      { status: 500 },
    );
  }
}
