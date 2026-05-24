import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUpcomingEvents } from "@/lib/calendar";
import { pickMomentSuggestion } from "@/lib/suggestions/moment";

/**
 * GET /api/suggestions/moment
 *
 * Returns the day's single Moment-to-Connect suggestion, or null when
 * today is too packed / no qualifying contact exists. Safe to call
 * repeatedly; the pick is deterministic per (user, date).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Pull today's events. Window = 1 day so we don't fetch a week.
  let events;
  try {
    events = await getUpcomingEvents(userId, 1);
  } catch {
    // Calendar not connected — surface gracefully as "no moment today".
    return NextResponse.json({ suggestion: null });
  }

  const todayLocal = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

  // Filter to events that actually start today.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const todayEvents = events.filter((e) => {
    const start = new Date(e.startTime).getTime();
    return start >= todayStart.getTime() && start < tomorrowStart.getTime();
  });

  const suggestion = await pickMomentSuggestion(userId, todayEvents, todayLocal);
  return NextResponse.json({ suggestion });
}
