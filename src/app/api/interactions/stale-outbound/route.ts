import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getStaleOutbound } from "@/lib/thread-intelligence";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const limit = Math.min(
    Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1),
    100,
  );
  const offset = Math.max(
    parseInt(searchParams.get("offset") ?? "0", 10) || 0,
    0,
  );
  const minDays = Math.max(
    parseInt(searchParams.get("minDays") ?? "7", 10) || 7,
    1,
  );

  try {
    const staleMessages = await getStaleOutbound(session.user.id, {
      limit,
      offset,
      minDays,
    });

    return NextResponse.json({
      data: staleMessages,
      count: staleMessages.length,
      limit,
      offset,
      minDays,
    });
  } catch (error) {
    console.error("Failed to fetch stale outbound messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch stale outbound messages" },
      { status: 500 },
    );
  }
}
