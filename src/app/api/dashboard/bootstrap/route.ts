import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUpcomingBirthdays, type UpcomingBirthday } from "@/lib/birthdays";
import { getUpcomingEvents, type UpcomingEvent } from "@/lib/calendar";
import {
  getDashboardStats,
  type DashboardStats,
} from "@/lib/dashboard/stats";
import {
  getDashboardObservations,
  type DashboardObservation,
} from "@/lib/dashboard/observations";
import { privateCacheHeaders } from "@/lib/http/cache";

export interface DashboardBootstrapResponse {
  stats: DashboardStats;
  calendar: {
    events: UpcomingEvent[];
    error?: string;
  };
  birthdays: UpcomingBirthday[];
  observations: DashboardObservation[];
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const [stats, calendar, birthdays, observations] = await Promise.all([
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
    getDashboardObservations(userId),
  ]);

  const response: DashboardBootstrapResponse = {
    stats,
    calendar,
    birthdays: [...birthdays],
    observations,
  };

  return NextResponse.json(response, {
    headers: privateCacheHeaders(30, 300),
  });
}
