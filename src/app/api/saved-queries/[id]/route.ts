import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/saved-queries/:id
 *   Removes a saved query. Ownership-scoped — the deleteMany check
 *   makes a wrong-user delete a no-op (returns count: 0) rather than
 *   leaking existence via 404 vs 200.
 *
 * PATCH /api/saved-queries/:id
 *   Body: { title?: string, bumpLastRunAt?: boolean }
 *   Updates title + optionally bumps lastRunAt (called when the user
 *   re-runs the query from /queries).
 */

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await prisma.savedQuery.deleteMany({
    where: { id, userId: session.user.id },
  });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    bumpLastRunAt?: boolean;
  };

  const data: { title?: string; lastRunAt?: Date } = {};
  if (typeof body.title === "string") {
    data.title = body.title.trim().slice(0, 120);
  }
  if (body.bumpLastRunAt) {
    data.lastRunAt = new Date();
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "no updatable fields in body" },
      { status: 400 },
    );
  }

  // updateMany scopes the where clause to the user without
  // exposing whether the row exists for someone else.
  const result = await prisma.savedQuery.updateMany({
    where: { id, userId: session.user.id },
    data,
  });
  return NextResponse.json({ ok: true, updated: result.count });
}
