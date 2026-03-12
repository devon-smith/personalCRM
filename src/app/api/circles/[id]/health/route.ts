import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCircleHealth } from "@/lib/circle-analytics";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const health = await getCircleHealth(id, session.user.id);
    if (!health) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(health);
  } catch (error) {
    console.error(`GET /api/circles/${id}/health error:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
