import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncCircleToGoogle } from "@/lib/circle-google-sync";

/**
 * PATCH /api/circles/[id]/google-sync
 * Body: { enabled: boolean }
 *
 * Turn Google contact-group sync on/off for a circle. Enabling does
 * NOT trigger an immediate sync — POST the same endpoint for that
 * (or wait for the next scheduled run once that's wired).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const updated = await prisma.circle.updateMany({
    where: { id, userId: session.user.id },
    data: { googleSyncEnabled: body.enabled, googleSyncError: null },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "Circle not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * POST /api/circles/[id]/google-sync
 *
 * Trigger an immediate one-way sync (CRM → Google) for this circle.
 * The caller must have already enabled sync via PATCH.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncCircleToGoogle(session.user.id, id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }
}
