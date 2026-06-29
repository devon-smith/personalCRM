import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { privateCacheHeaders } from "@/lib/http/cache";
import { getContactMomentum } from "@/lib/momentum";

const READ_CACHE_HEADERS = privateCacheHeaders(5 * 60, 30 * 60);

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contactIds = req.nextUrl.searchParams.get("contactIds");
  const ids = contactIds ? contactIds.split(",").filter(Boolean) : undefined;

  const normalizedIds = ids ? [...new Set(ids)].sort() : undefined;

  const momentum = await getContactMomentum(session.user.id, normalizedIds);

  return NextResponse.json({ momentum }, { headers: READ_CACHE_HEADERS });
}
