import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET  /api/saved-queries
 *   Lists the user's query history with full answers + evidence.
 *   Sorted by lastRunAt desc, createdAt desc tiebreak.
 *
 *   Query params (all client-side filterable too, but these let the
 *   server cap payload size for power users):
 *     ?starred=1            → only isStarred=true
 *     ?since=<isoDate>      → createdAt >= that date
 *     ?limit=N (default 50) → cap
 *
 * POST /api/saved-queries
 *   Legacy save-query path. M0.x.7: every query auto-saves via
 *   /api/network-query, so this endpoint is no longer the primary
 *   write surface. Kept for backwards compatibility with the M7.4
 *   client code that posted a query+title without an answer.
 *
 * Per-query mutation lives at /api/saved-queries/[id] (PATCH, DELETE).
 */

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const starredOnly = url.searchParams.get("starred") === "1";
  const since = url.searchParams.get("since");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(200, Math.max(1, Number(limitParam))) : 50;

  const includeFollowUps = url.searchParams.get("includeFollowUps") === "1";

  const where: {
    userId: string;
    isStarred?: boolean;
    createdAt?: { gte: Date };
    parentQueryId?: null;
  } = { userId: session.user.id };
  if (starredOnly) where.isStarred = true;
  if (since) {
    const date = new Date(since);
    if (!isNaN(date.getTime())) where.createdAt = { gte: date };
  }
  // M0.x.9: by default the top-level list hides follow-ups (they
  // render nested under their parent on /ask/[id]). Set
  // ?includeFollowUps=1 to get every row including children.
  if (!includeFollowUps) where.parentQueryId = null;

  const queries = await prisma.savedQuery.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: limit,
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
  return NextResponse.json({ queries });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    query?: string;
    title?: string;
  };
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  if (query.length > 1000) {
    return NextResponse.json(
      { error: "query too long (max 1000 chars)" },
      { status: 400 },
    );
  }
  const title =
    typeof body.title === "string" && body.title.trim().length > 0
      ? body.title.trim().slice(0, 120)
      : null;

  // Legacy path — no answer/evidence. UI should prefer running
  // through /api/network-query which auto-saves with the answer.
  const saved = await prisma.savedQuery.create({
    data: {
      userId: session.user.id,
      query,
      title,
    },
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
  return NextResponse.json({ savedQuery: saved });
}
