import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** POST — Dismiss an unresponded thread so it no longer appears in "Awaiting your reply" */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Use raw SQL — PrismaPg driver adapter has issues with .update() on newer columns
    const rowsUpdated = await prisma.$executeRaw`
      UPDATE "Interaction"
      SET "dismissedAt" = NOW()
      WHERE "id" = ${id} AND "userId" = ${session.user.id}
    `;

    if (rowsUpdated === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Dismiss error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to dismiss" },
      { status: 500 },
    );
  }
}
