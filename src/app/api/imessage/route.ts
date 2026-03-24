import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getConversations } from "@/lib/imessage";
import { syncIMessages } from "@/lib/imessage-sync";

// Re-export for consumers that import the type from this route
export type { IMessageSyncResult } from "@/lib/imessage-sync";

// ─── GET — Preview iMessage conversations ────────────────────

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await getConversations(60);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      conversations: result.conversations,
      total: result.total,
    });
  } catch (error) {
    console.error("iMessage read error:", error);
    return NextResponse.json(
      { error: "Failed to read iMessages" },
      { status: 500 },
    );
  }
}

// ─── POST — Sync iMessages as Interactions ───────────────────

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") ?? "60", 10) || 60, 1), 90);

  try {
    const result = await syncIMessages(session.user.id, days);
    return NextResponse.json(result);
  } catch (error) {
    console.error("iMessage sync error:", error);
    const message = error instanceof Error ? error.message : "Failed to sync iMessages";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
