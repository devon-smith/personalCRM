import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/saved-queries/:id
 *   Returns one full SavedQuery row (with answer + evidence). Used
 *   by the /ask/[id] deep-link page.
 *
 * DELETE /api/saved-queries/:id
 *   Removes a saved query. Ownership-scoped — the deleteMany check
 *   makes a wrong-user delete a no-op (returns count: 0) rather than
 *   leaking existence via 404 vs 200.
 *
 * PATCH /api/saved-queries/:id
 *   Body: { title?: string, bumpLastRunAt?: boolean, isStarred?: boolean }
 *   M0.x.7 — adds isStarred toggle so /ask history can star/unstar
 *   without touching the answer.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const row = await prisma.savedQuery.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      query: true,
      title: true,
      answer: true,
      evidence: true,
      isStarred: true,
      runCount: true,
      createdAt: true,
      lastRunAt: true,
      parentQueryId: true,
      followUpCount: true,
    },
  });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // M0.x.9: pull the follow-up thread (children) chronologically so
  // /ask/[id] can render the conversation under the parent answer.
  // Owner-scoped via session userId for safety.
  const followUps = await prisma.savedQuery.findMany({
    where: { parentQueryId: id, userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      query: true,
      title: true,
      answer: true,
      evidence: true,
      isStarred: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ savedQuery: row, followUps });
}

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
    isStarred?: boolean;
    incrementRunCount?: boolean;
  };

  const data: {
    title?: string;
    lastRunAt?: Date;
    isStarred?: boolean;
    runCount?: { increment: number };
  } = {};
  if (typeof body.title === "string") {
    data.title = body.title.trim().slice(0, 120);
  }
  if (body.bumpLastRunAt) {
    data.lastRunAt = new Date();
  }
  if (typeof body.isStarred === "boolean") {
    data.isStarred = body.isStarred;
  }
  if (body.incrementRunCount) {
    data.runCount = { increment: 1 };
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
