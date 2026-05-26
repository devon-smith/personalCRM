import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/observations/:id/dismiss
 *
 * Marks an observation as dismissed. The row stays in the table for
 * history + analytics but never re-surfaces in /api/observations.
 *
 * updateMany scopes the where clause to the session user so a wrong-
 * user dismiss is a no-op (returns count: 0) rather than leaking
 * existence via 404 vs 200.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const result = await prisma.assistantObservation.updateMany({
    where: { id, userId: session.user.id, dismissedAt: null },
    data: { dismissedAt: new Date() },
  });
  return NextResponse.json({ ok: true, dismissed: result.count });
}
