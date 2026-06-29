import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { establishGmailWatch } from "@/lib/gmail/watch";
import { establishCalendarWatches } from "@/lib/calendar-watch";

const SETUP_PUSH_REUSE_MS = 60_000;

interface SetupPushResult {
  gmail: { ok: boolean; expiresAt?: string; error?: string };
  calendar: { ok: boolean; channels: number; error?: string };
  configured: { gmailPubsub: boolean; webhookBase: boolean; webhookToken: boolean };
}

const inFlightSetup = new Map<string, Promise<SetupPushResult>>();
const recentSetupResults = new Map<string, { expiresAt: number; result: SetupPushResult }>();

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
  const userId = session.user.id;

  const recent = recentSetupResults.get(userId);
  if (recent && recent.expiresAt > Date.now()) {
    return NextResponse.json({ ...recent.result, cached: true });
  }

  const existing = inFlightSetup.get(userId);
  if (existing) {
    const result = await existing;
    return NextResponse.json({ ...result, cached: true });
  }

  const setup = runSetupPush(userId);
  inFlightSetup.set(userId, setup);
  try {
    const result = await setup;
    recentSetupResults.set(userId, {
      result,
      expiresAt: Date.now() + SETUP_PUSH_REUSE_MS,
    });
    return NextResponse.json(result);
  } finally {
    if (inFlightSetup.get(userId) === setup) {
      inFlightSetup.delete(userId);
    }
  }
}

async function runSetupPush(userId: string): Promise<SetupPushResult> {
  const result: SetupPushResult = {
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
      const r = await establishGmailWatch(userId);
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
      const channels = await establishCalendarWatches(userId);
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

  return result;
}
