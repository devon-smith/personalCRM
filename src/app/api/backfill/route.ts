import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runBackfill } from "@/lib/backfill";

/**
 * POST /api/backfill
 * Body: { sources: ["imessage", "gmail"], days?: number }
 *
 * Runs a 3-month backfill from real data sources.
 * Safe to run multiple times — deduplicates by sourceId.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const body = await request.json().catch(() => ({}));
    const sources: string[] = body.sources ?? ["imessage", "gmail"];
    const days: number = Math.min(Math.max(body.days ?? 90, 1), 365);

    const validSources = sources.filter((s) =>
      ["imessage", "gmail"].includes(s),
    );

    if (validSources.length === 0) {
      return NextResponse.json(
        { error: "No valid sources. Use 'imessage' and/or 'gmail'." },
        { status: 400 },
      );
    }

    console.log(
      `[backfill] Starting backfill for user ${userId}: sources=${validSources.join(",")}, days=${days}`,
    );

    const result = await runBackfill(userId, validSources, days);

    console.log(
      `[backfill] Complete. Total interactions: ${result.totalInteractionsAfter}, contacts: ${result.totalContacts}`,
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("[backfill] Error:", error);
    const message =
      error instanceof Error ? error.message : "Backfill failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
