import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { searchContacts } from "@/lib/search/contacts";

/**
 * GET /api/search/contacts?q=...&limit=...
 *
 * Layered fuzzy search across name, email, and company. Returns up to
 * `limit` hits ranked by combined similarity score. Empty query returns
 * an empty array (the caller should not fire requests for empty input).
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(50, Math.max(1, parseInt(limitParam, 10) || 12)) : 12;

  if (!q.trim()) {
    return NextResponse.json({ hits: [] });
  }

  try {
    const hits = await searchContacts(session.user.id, q, limit);
    return NextResponse.json({ hits });
  } catch (err) {
    console.error("[/api/search/contacts] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 500 },
    );
  }
}
