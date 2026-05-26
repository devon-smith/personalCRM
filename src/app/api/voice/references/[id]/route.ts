import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/voice/references/:id — remove a voice reference.
 * Hard delete; future drafts won't inherit its guidance.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const result = await prisma.voiceReference.deleteMany({
      where: { id, userId: session.user.id },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/voice/references/[id]]", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}

/**
 * GET /api/voice/references/:id — fetch the full row including
 * content + guidance (the list endpoint omits content for size).
 */
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
    const row = await prisma.voiceReference.findFirst({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        filename: true,
        sourceType: true,
        content: true,
        weight: true,
        byteSize: true,
        guidance: true,
        addedAt: true,
      },
    });
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      reference: { ...row, addedAt: row.addedAt.toISOString() },
    });
  } catch (error) {
    console.error("[GET /api/voice/references/[id]]", error);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
}
