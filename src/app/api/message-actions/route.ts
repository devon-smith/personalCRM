import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  extractMessageActions,
  getMessageActionItems,
} from "@/lib/message-actions";

// ─── GET: recent message-sourced action items ────────────────

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const items = await getMessageActionItems(session.user.id);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[GET /api/message-actions]", error);
    return NextResponse.json(
      { error: "Failed to get action items" },
      { status: 500 },
    );
  }
}

// ─── POST: run AI extraction on new messages ─────────────────

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await extractMessageActions(session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/message-actions]", error);
    return NextResponse.json(
      { error: "Failed to extract actions" },
      { status: 500 },
    );
  }
}

// ─── DELETE: reset all message action items for re-scan ──────

export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const deleted = await prisma.actionItem.deleteMany({
      where: {
        userId: session.user.id,
        OR: [
          { sourceId: { startsWith: "msg:" } },
          { sourceId: { startsWith: "email:" } },
        ],
      },
    });

    return NextResponse.json({ deleted: deleted.count });
  } catch (error) {
    console.error("[DELETE /api/message-actions]", error);
    return NextResponse.json(
      { error: "Failed to reset action items" },
      { status: 500 },
    );
  }
}

// ─── PATCH: update action item status ────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, status } = (await req.json()) as {
      id: string;
      status: "DONE" | "DISMISSED";
    };

    if (!id || !["DONE", "DISMISSED"].includes(status)) {
      return NextResponse.json(
        { error: "id and status (DONE|DISMISSED) required" },
        { status: 400 },
      );
    }

    await prisma.actionItem.updateMany({
      where: { id, userId: session.user.id },
      data: { status, resolvedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[PATCH /api/message-actions]", error);
    return NextResponse.json(
      { error: "Failed to update action item" },
      { status: 500 },
    );
  }
}
