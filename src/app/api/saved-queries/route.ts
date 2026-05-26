import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET  /api/saved-queries
 *   Lists the user's saved queries. Sorted by lastRunAt desc
 *   (most-recently re-run first), createdAt desc tiebreak.
 *
 * POST /api/saved-queries
 *   Body: { query: string, title?: string }
 *   Creates a new saved query for the user.
 *
 * Per-query deletion lives at /api/saved-queries/[id].
 */

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const queries = await prisma.savedQuery.findMany({
    where: { userId: session.user.id },
    orderBy: [{ lastRunAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      query: true,
      title: true,
      createdAt: true,
      lastRunAt: true,
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
      createdAt: true,
      lastRunAt: true,
    },
  });
  return NextResponse.json({ savedQuery: saved });
}
