import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { enqueue } from "../../../../../worker/queue-client";

/**
 * POST /api/voice/reindex
 *
 * Manually enqueue a voice-corpus-index pass for the current user.
 * Useful after Jennifer adjusts filters or removes a signature phrase
 * and wants the new fingerprint visible right away (instead of waiting
 * for the weekly cron at Sun 09:42 UTC).
 *
 * Accepts an optional `?rebuild=1` to force re-extraction of features
 * for emails that already have a VoiceExample (useful after the
 * feature-extraction code changes).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const rebuild = url.searchParams.get("rebuild") === "1";
  const jobId = await enqueue("voice-corpus-index", {
    userId: session.user.id,
    rebuild,
  });
  return NextResponse.json({ ok: true, jobId, rebuild });
}
