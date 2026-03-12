import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { initialGmailSync, incrementalGmailSync } from "@/lib/gmail/sync";

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
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const syncState = await prisma.gmailSyncState.findUnique({
      where: { userId: session.user.id },
    });

    let result;
    if (syncState?.historyId) {
      result = await incrementalGmailSync(session.user.id);
    } else {
      result = await initialGmailSync(session.user.id);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Gmail sync error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to sync Gmail. You may need to reconnect your Google account.",
      },
      { status: 500 },
    );
  }
}
