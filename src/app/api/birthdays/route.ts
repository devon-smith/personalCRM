import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUpcomingBirthdays } from "@/lib/birthdays";
import { syncBirthdaysFromCalendar } from "@/lib/birthday-sync";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = Number(req.nextUrl.searchParams.get("days") ?? "14");

  const birthdays = await getUpcomingBirthdays(session.user.id, days);

  return NextResponse.json({ birthdays });
}

/** POST — Sync birthdays from Google Calendar into contacts */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncBirthdaysFromCalendar(session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/birthdays]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync birthdays" },
      { status: 500 },
    );
  }
}
