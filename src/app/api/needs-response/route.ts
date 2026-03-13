import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { scanNeedsResponse } from "@/lib/automation/needs-response";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const items = await scanNeedsResponse(session.user.id);

    const counts = {
      high: items.filter((i) => i.priority === "high").length,
      medium: items.filter((i) => i.priority === "medium").length,
      low: items.filter((i) => i.priority === "low").length,
      total: items.length,
    };

    return NextResponse.json({ items, counts });
  } catch (error) {
    console.error("[GET /api/needs-response]", error);
    return NextResponse.json(
      { error: "Failed to scan for items needing response" },
      { status: 500 },
    );
  }
}
