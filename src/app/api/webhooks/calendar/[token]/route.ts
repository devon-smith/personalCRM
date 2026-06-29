import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueue } from "../../../../../../worker/queue-client";

/**
 * POST /api/webhooks/calendar/[token]
 *
 * Receives Google Calendar push notifications. The body is empty;
 * everything useful is in headers:
 *   X-Goog-Channel-Id      — the channel we created
 *   X-Goog-Channel-Token   — our shared secret (re-validated)
 *   X-Goog-Resource-State  — "sync" | "exists" | "not_exists"
 *   X-Goog-Resource-Id     — Google's id for the watched resource
 *
 * On any actionable state (not "sync", which is the initial handshake),
 * map the channel back to a userId via CalendarWatchChannel and
 * enqueue a calendar-sync job.
 *
 * https://developers.google.com/calendar/api/guides/push#receiving-notifications
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!process.env.WEBHOOK_TOKEN || token !== process.env.WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const headerToken = req.headers.get("x-goog-channel-token");
  if (headerToken !== process.env.WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const channelId = req.headers.get("x-goog-channel-id");
  const state = req.headers.get("x-goog-resource-state");
  if (!channelId) {
    return NextResponse.json({ error: "Missing channel id" }, { status: 400 });
  }

  // The "sync" state fires once per channel as a handshake — Google
  // confirming the webhook is reachable. Ack and move on.
  if (state === "sync") return NextResponse.json({ ok: true });

  const channel = await prisma.calendarWatchChannel.findFirst({
    where: { channelId },
    select: { userId: true },
  });
  if (!channel) {
    // Unknown channel — could be from a previous deployment whose
    // CalendarWatchChannel row was wiped. Ack so Google stops
    // retrying.
    return NextResponse.json({ ok: true });
  }

  try {
    await enqueue(
      "calendar-sync",
      { triggeredBy: "webhook", userId: channel.userId },
      {
        jobKey: `calendar-sync:webhook:${channel.userId}`,
        jobKeyMode: "preserve_run_at",
        queueName: `calendar-sync:${channel.userId}`,
      },
    );
  } catch (err) {
    console.error("[webhook/calendar] enqueue failed:", err);
  }

  return NextResponse.json({ ok: true });
}
