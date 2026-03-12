import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAllCircleHealth } from "@/lib/circle-analytics";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const health = await getAllCircleHealth(session.user.id);

    return NextResponse.json(health);
  } catch (error) {
    console.error("GET /api/circles/health error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
