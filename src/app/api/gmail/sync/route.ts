import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runGmailSyncForUser } from "@/lib/sync/google-sync-runs";
import { parseSyncTrigger } from "@/lib/sync/run-telemetry";

/** GET — Check sync status */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const syncState = await prisma.gmailSyncState.findUnique({
    where: { userId: session.user.id },
  });

  if (!syncState) {
    return NextResponse.json({
      synced: false,
      syncEnabled: false,
      lastSyncAt: null,
      contactsImported: false,
    });
  }

  return NextResponse.json({
    synced: !!syncState.historyId,
    syncEnabled: syncState.syncEnabled,
    lastSyncAt: syncState.lastSyncAt,
    contactsImported: syncState.contactsImported,
  });
}

/** POST — Trigger a sync */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const trigger = parseSyncTrigger(new URL(request.url).searchParams.get("trigger") ?? "manual");

  // Check if Google account exists before attempting sync
  const googleAccount = await prisma.account.findFirst({
    where: { userId: session.user.id, provider: "google" },
    select: { access_token: true },
  });

  if (!googleAccount?.access_token) {
    return NextResponse.json(
      { error: "No Google account connected", processed: 0 },
      { status: 400 },
    );
  }

  try {
    const result = await runGmailSyncForUser(session.user.id, trigger);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Gmail sync error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to sync Gmail. You may need to reconnect your Google account.",
        processed: 0,
      },
      { status: 500 },
    );
  }
}
