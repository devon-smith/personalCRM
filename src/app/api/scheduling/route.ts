import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSchedulingSuggestions } from "@/lib/smart-scheduling";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const suggestions = await getSchedulingSuggestions(session.user.id);
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("[GET /api/scheduling]", error);
    return NextResponse.json({ suggestions: [] });
  }
}
