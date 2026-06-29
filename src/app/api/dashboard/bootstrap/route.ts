import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUpcomingBirthdays, type UpcomingBirthday } from "@/lib/birthdays";
import { getUpcomingEvents, type UpcomingEvent } from "@/lib/calendar";
import {
  getDashboardStats,
  type DashboardStats,
} from "@/lib/dashboard/stats";

export interface DashboardBootstrapResponse {
  stats: DashboardStats;
  calendar: {
    events: UpcomingEvent[];
    error?: string;
  };
  birthdays: UpcomingBirthday[];
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const [stats, calendar, birthdays] = await Promise.all([
    getDashboardStats(userId),
    getUpcomingEvents(userId, 7)
      .then((events) => ({ events }))
      .catch((error) => ({
        events: [],
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch calendar events",
      })),
    getUpcomingBirthdays(userId, 30),
  ]);

  const response: DashboardBootstrapResponse = {
    stats,
    calendar,
    birthdays: [...birthdays],
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "private, max-age=30",
    },
  });
}
