import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { UnmatchedHandle } from "@/lib/notion-messages";

// ─── GET: fetch unmatched handles from last sync ─────────────

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = await prisma.notionSyncState.findUnique({
      where: { userId: session.user.id },
    });

    if (!config?.lastResult) {
      return NextResponse.json({ handles: [] });
    }

    let lastResult: { unmatchedHandles?: UnmatchedHandle[] };
    try {
      lastResult = JSON.parse(config.lastResult);
    } catch {
      return NextResponse.json({ handles: [] });
    }

    return NextResponse.json({
      handles: lastResult.unmatchedHandles ?? [],
      lastSyncAt: config.lastSyncAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("[GET /api/notion-messages/unmatched]", error);
    return NextResponse.json(
      { error: "Failed to get unmatched handles" },
      { status: 500 },
    );
  }
}

// ─── POST: assign a handle to a contact (creates interactions) ──

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { handle, contactId, phone } = (await req.json()) as {
      handle: string;
      contactId: string;
      phone?: boolean;
    };

    if (!handle || !contactId) {
      return NextResponse.json(
        { error: "handle and contactId are required" },
        { status: 400 },
      );
    }

    // Verify contact belongs to user
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, userId: session.user.id },
      select: { id: true, name: true, phone: true },
    });

    if (!contact) {
      return NextResponse.json(
        { error: "Contact not found" },
        { status: 404 },
      );
    }

    // If this is a phone handle and the contact doesn't have a phone, save it
    if (phone && !contact.phone) {
      await prisma.contact.update({
        where: { id: contactId },
        data: { phone: handle },
      });
    }

    return NextResponse.json({ ok: true, contactName: contact.name });
  } catch (error) {
    console.error("[POST /api/notion-messages/unmatched]", error);
    return NextResponse.json(
      { error: "Failed to assign handle" },
      { status: 500 },
    );
  }
}
