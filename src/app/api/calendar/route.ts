import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  clearUpcomingEventsCache,
  getUpcomingEvents,
  type CalendarSyncResult,
} from "@/lib/calendar";
import {
  getCalendarSyncStatus,
  type CalendarSyncStatus,
} from "@/lib/calendar/status";
import { privateCacheHeaders } from "@/lib/http/cache";
import { runCalendarSyncForUser } from "@/lib/sync/google-sync-runs";
import { parseSyncTrigger } from "@/lib/sync/run-telemetry";

export type { CalendarSyncResult };
export type { CalendarSyncStatus };

function calendarConnectionError(status: CalendarSyncStatus): string | null {
  if (status.connection === "not_connected") {
    return "Google account not connected. Please sign in with Google first.";
  }
  if (status.connection === "missing_scope") {
    return "Calendar scope not granted. Please re-authenticate to grant Calendar access.";
  }
  return null;
}

const READ_CACHE_HEADERS = privateCacheHeaders(30, 300);

/** GET — Fetch upcoming calendar events */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const syncStatus = await getCalendarSyncStatus(session.user.id);
  const connectionError = calendarConnectionError(syncStatus);
  if (connectionError) {
    return NextResponse.json(
      { events: [], syncStatus, error: connectionError },
      { status: 200, headers: READ_CACHE_HEADERS },
    );
  }

  try {
    const events = await getUpcomingEvents(session.user.id, 7);
    return NextResponse.json(
      { events, syncStatus },
      { headers: READ_CACHE_HEADERS },
    );
  } catch (error) {
    console.error("Calendar fetch error:", error);
    // Return empty events with error message instead of 500
    return NextResponse.json(
      {
        events: [],
        syncStatus,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch calendar events",
      },
      { status: 200, headers: READ_CACHE_HEADERS },
    );
  }
}

/** POST — Sync past 90 days of calendar events as MEETING interactions */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const trigger = parseSyncTrigger(new URL(request.url).searchParams.get("trigger") ?? "manual");

  const syncStatus = await getCalendarSyncStatus(session.user.id);
  const connectionError = calendarConnectionError(syncStatus);
  if (connectionError) {
    return NextResponse.json(
      { events: [], syncStatus, error: connectionError },
      { status: 200 },
    );
  }

  try {
    clearUpcomingEventsCache(session.user.id);
    const result = await runCalendarSyncForUser(session.user.id, trigger, 90);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Calendar sync error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to sync calendar events",
      },
      { status: 500 },
    );
  }
}
