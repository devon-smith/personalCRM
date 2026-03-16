import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

    const item = await prisma.inboxItem.findFirst({
      where: { id: itemId, userId: session.user.id },
    });

    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    await prisma.inboxItem.update({
      where: { id: itemId },
      data: {
        status: "DISMISSED",
        resolvedAt: new Date(),
        resolvedBy: "dismissed",
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/inbox-items/[itemId]/dismiss]", error);
    return NextResponse.json(
      { error: "Failed to dismiss item" },
      { status: 500 },
    );
  }
}
