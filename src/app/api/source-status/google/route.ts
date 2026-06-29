import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getGoogleSourceStatus } from "@/lib/source-status/google";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(await getGoogleSourceStatus(session.user.id));
  } catch (error) {
    console.error("[GET /api/source-status/google]", error);
    return NextResponse.json(
      { error: "Failed to fetch Google source status" },
      { status: 500 },
    );
  }
}
