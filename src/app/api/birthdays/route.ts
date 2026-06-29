import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUpcomingBirthdays } from "@/lib/birthdays";
import { syncBirthdaysFromCalendar } from "@/lib/birthday-sync";
import { privateCacheHeaders } from "@/lib/http/cache";

const BIRTHDAY_SYNC_REUSE_MS = 60_000;
type BirthdaySyncRunResult = Awaited<ReturnType<typeof syncBirthdaysFromCalendar>>;

const inFlightBirthdaySync = new Map<string, Promise<BirthdaySyncRunResult>>();
const recentBirthdaySync = new Map<
  string,
  {
    expiresAt: number;
    result: BirthdaySyncRunResult;
  }
>();

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = Number(req.nextUrl.searchParams.get("days") ?? "14");

  const birthdays = await getUpcomingBirthdays(session.user.id, days);

  return NextResponse.json(
    { birthdays },
    { headers: privateCacheHeaders(5 * 60, 30 * 60) },
  );
}

/** POST — Sync birthdays from Google Calendar into contacts */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  let activeSync: Promise<BirthdaySyncRunResult> | null = null;

  try {
    const recent = recentBirthdaySync.get(userId);
    if (recent && recent.expiresAt > Date.now()) {
      return NextResponse.json({ ...recent.result, cached: true });
    }

    const existing = inFlightBirthdaySync.get(userId);
    if (existing) {
      const result = await existing;
      return NextResponse.json({ ...result, cached: true });
    }

    const sync = syncBirthdaysFromCalendar(userId);
    activeSync = sync;
    inFlightBirthdaySync.set(userId, sync);
    const result = await sync;
    recentBirthdaySync.set(userId, {
      result,
      expiresAt: Date.now() + BIRTHDAY_SYNC_REUSE_MS,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/birthdays]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync birthdays" },
      { status: 500 },
    );
  } finally {
    if (activeSync && inFlightBirthdaySync.get(userId) === activeSync) {
      inFlightBirthdaySync.delete(userId);
    }
  }
}
