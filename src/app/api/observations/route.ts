import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/observations
 *
 * Returns the user's undismissed assistant observations, newest
 * first. UI on the dashboard typically renders 1-2 at a time.
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

  const observations = await prisma.assistantObservation.findMany({
    where: { userId: session.user.id, dismissedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      content: true,
      contactId: true,
      source: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ observations });
}
