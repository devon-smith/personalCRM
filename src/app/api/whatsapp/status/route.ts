import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/whatsapp/status
 * Returns the WhatsApp sync state for the current user.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const syncState = await prisma.whatsAppSyncState.findUnique({
      where: { userId: session.user.id },
    });

    if (!syncState) {
      return NextResponse.json({
        status: "not_configured",
        connected: false,
        messagesSynced: 0,
        contactsMatched: 0,
        unmatchedChats: [],
      });
    }

    return NextResponse.json({
      status: syncState.connected ? "connected" : "disconnected",
      connected: syncState.connected,
      phone: syncState.phone,
      lastMessageAt: syncState.lastMessageAt?.toISOString() ?? null,
      messagesSynced: syncState.messagesSynced,
      contactsMatched: syncState.contactsMatched,
      unmatchedChats: syncState.unmatchedChats ?? [],
      lastSyncAt: syncState.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("[GET /api/whatsapp/status]", error);
    return NextResponse.json(
      { error: "Failed to get WhatsApp status" },
      { status: 500 },
    );
  }
}
