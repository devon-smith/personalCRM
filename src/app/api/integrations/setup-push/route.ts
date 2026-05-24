import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { establishGmailWatch } from "@/lib/gmail/watch";
import { establishCalendarWatches } from "@/lib/calendar-watch";

/**
 * POST /api/integrations/setup-push
 *
 * One-click "wire up Gmail + Calendar push for the current user." Hits
 * Google's watch endpoints with the configured Pub/Sub topic (gmail)
 * and webhook URL (calendar). Idempotent — re-running just refreshes
 * the channels.
 *
 * Returns a summary so the UI can confirm what was established. Surfaces
 * partial success when (say) Gmail works but Calendar fails.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result: {
    gmail: { ok: boolean; expiresAt?: string; error?: string };
    calendar: { ok: boolean; channels: number; error?: string };
    configured: { gmailPubsub: boolean; webhookBase: boolean; webhookToken: boolean };
  } = {
    gmail: { ok: false },
    calendar: { ok: false, channels: 0 },
    configured: {
      gmailPubsub: !!process.env.GMAIL_PUBSUB_TOPIC,
      webhookBase: !!process.env.WEBHOOK_BASE_URL,
      webhookToken: !!process.env.WEBHOOK_TOKEN,
    },
  };

  // Gmail
  if (result.configured.gmailPubsub) {
    try {
      const r = await establishGmailWatch(session.user.id);
      if (r) {
        result.gmail = { ok: true, expiresAt: r.expiration.toISOString() };
      } else {
        result.gmail = { ok: false, error: "Watch returned null (topic missing?)" };
      }
    } catch (err) {
      result.gmail = {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  } else {
    result.gmail.error = "GMAIL_PUBSUB_TOPIC not set";
  }

  // Calendar
  if (result.configured.webhookBase && result.configured.webhookToken) {
    try {
      const channels = await establishCalendarWatches(session.user.id);
      result.calendar = { ok: channels.length > 0, channels: channels.length };
    } catch (err) {
      result.calendar = {
        ok: false,
        channels: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  } else {
    result.calendar.error = "WEBHOOK_BASE_URL / WEBHOOK_TOKEN not set";
  }

  return NextResponse.json(result);
}
