import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUnrespondedThreads } from "@/lib/thread-intelligence";

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

  try {
    const threads = await getUnrespondedThreads(session.user.id, {
      limit,
      offset,
    });

    return NextResponse.json({
      data: threads,
      count: threads.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Failed to fetch unresponded threads:", error);
    return NextResponse.json(
      { error: "Failed to fetch unresponded threads" },
      { status: 500 },
    );
  }
}
