import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDashboardObservations } from "@/lib/dashboard/observations";

/**
 * GET /api/observations
 *
 * Returns the user's undismissed assistant observations, newest
 * first. UI on the dashboard typically renders 1-2 at a time.
 *
 * Render-time stale-check (M0.5): for `unanswered_inbound`
 * observations, re-verify against the underlying thread before
 * returning. If the user has since replied (any OUTBOUND in the
 * same threadId after the inbound), drop from the response and
 * auto-dismiss the row. This handles observations created by an
 * earlier worker run that have since been resolved.
 *
 * Mark-as-shown happens lazily on render (PATCH not required) —
 * the existence of an observation is enough; we don't need
 * impression tracking for v1.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const observations = await getDashboardObservations(userId);
  return NextResponse.json({ observations });
}
