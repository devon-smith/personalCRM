import { NextResponse } from "next/server";
import { authExtension } from "@/lib/extension-auth";
import { prisma } from "@/lib/prisma";

interface HeartbeatBody {
  connected: boolean;
  phone?: string;
}

/**
 * POST /api/whatsapp/heartbeat
 * Called by the WhatsApp sidecar every 60s to report connection status.
 */
export async function POST(request: Request) {
  try {
    const authResult = await authExtension(request);
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.userId;

    const body = (await request.json()) as HeartbeatBody;

    await prisma.whatsAppSyncState.upsert({
      where: { userId },
      create: {
        userId,
        phone: body.phone ?? "",
        connected: body.connected,
      },
      update: {
        connected: body.connected,
        ...(body.phone ? { phone: body.phone } : {}),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/whatsapp/heartbeat]", error);
    return NextResponse.json(
      { error: "Failed to process heartbeat" },
      { status: 500 },
    );
  }
}
