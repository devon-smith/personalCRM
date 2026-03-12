import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getUpcomingEvents,
  syncCalendarEvents,
  type CalendarSyncResult,
} from "@/lib/calendar";

export type { CalendarSyncResult };

/**
 * Check if the user has the calendar.readonly scope granted.
 * Returns null if OK, or a JSON response to send back if not.
 */
async function checkCalendarScope(userId: string): Promise<NextResponse | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: { scope: true, access_token: true },
  });

  if (!account?.access_token) {
    return NextResponse.json(
      { error: "Google account not connected. Please sign in with Google first.", events: [] },
      { status: 200 },
    );
  }

  if (!account.scope?.includes("calendar.readonly")) {
    return NextResponse.json(
      { error: "Calendar scope not granted. Please re-authenticate to grant Calendar access.", events: [] },
      { status: 200 },
    );
  }

  return null;
}

/** GET — Fetch upcoming calendar events */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scopeCheck = await checkCalendarScope(session.user.id);
  if (scopeCheck) return scopeCheck;

  try {
    const events = await getUpcomingEvents(session.user.id, 7);
    return NextResponse.json({ events });
  } catch (error) {
    console.error("Calendar fetch error:", error);
    // Return empty events with error message instead of 500
    return NextResponse.json(
      {
        events: [],
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch calendar events",
      },
      { status: 200 },
    );
  }
}

/** POST — Sync past 90 days of calendar events as MEETING interactions */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scopeCheck = await checkCalendarScope(session.user.id);
  if (scopeCheck) return scopeCheck;

  try {
    const result = await syncCalendarEvents(session.user.id, 90);
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
