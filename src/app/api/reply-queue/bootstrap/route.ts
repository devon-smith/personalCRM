import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getReplyQueueBootstrap } from "@/lib/reply-queue/bootstrap";
import type { ReplyQueueInboxView } from "@/lib/reply-queue/inbox-items";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const view: ReplyQueueInboxView =
      url.searchParams.get("view") === "all" ? "all" : "needs-reply";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 50);

    const data = await getReplyQueueBootstrap(session.user.id, {
      view,
      draftLimit: Number.isFinite(limit) ? limit : 50,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("[GET /api/reply-queue/bootstrap]", error);
    return NextResponse.json(
      { error: "Failed to fetch reply queue" },
      { status: 500 },
    );
  }
}
