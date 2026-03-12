import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { discoverContactsFromGmail } from "@/lib/gmail/discover";
import type { DiscoverResult } from "@/lib/gmail/discover";

export type { DiscoverResult };

/** POST — Scan Gmail and auto-create contacts + interactions */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await discoverContactsFromGmail(session.user.id, 90, 500);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Gmail discover error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to scan Gmail. You may need to reconnect your Google account.",
      },
      { status: 500 },
    );
  }
}
