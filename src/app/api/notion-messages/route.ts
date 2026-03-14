import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  syncNotionMessages,
  testNotionConnection,
} from "@/lib/notion-messages";

// ─── GET: sync status ────────────────────────────────────────

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = await prisma.notionSyncState.findUnique({
      where: { userId: session.user.id },
    });

    if (!config?.notionToken || !config?.notionPageId) {
      return NextResponse.json({
        configured: false,
        lastSyncAt: null,
        lastResult: null,
        userHandles: [],
      });
    }

    let lastResult = null;
    if (config.lastResult) {
      try {
        lastResult = JSON.parse(config.lastResult);
      } catch {
        lastResult = null;
      }
    }

    let userHandles: string[] = [];
    if (config.userHandles) {
      try {
        userHandles = JSON.parse(config.userHandles);
      } catch {
        userHandles = [];
      }
    }

    return NextResponse.json({
      configured: true,
      lastSyncAt: config.lastSyncAt?.toISOString() ?? null,
      lastResult,
      userHandles,
    });
  } catch (error) {
    console.error("[GET /api/notion-messages]", error);
    return NextResponse.json(
      { error: "Failed to get sync status" },
      { status: 500 },
    );
  }
}

// ─── POST: trigger sync ─────────────────────────────────────

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = await prisma.notionSyncState.findUnique({
      where: { userId: session.user.id },
    });

    if (!config?.notionToken || !config?.notionPageId) {
      return NextResponse.json(
        { error: "Not configured" },
        { status: 400 },
      );
    }

    // Build user handles list
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true },
    });

    const userHandles: string[] = [];
    if (user?.email) userHandles.push(user.email);
    if (config.userHandles) {
      try {
        userHandles.push(...JSON.parse(config.userHandles));
      } catch {
        // Invalid JSON — skip
      }
    }

    if (userHandles.length === 0) {
      return NextResponse.json(
        { error: "No handles configured. Add your email or phone in settings." },
        { status: 400 },
      );
    }

    const { newLastBlockId, ...result } = await syncNotionMessages(
      session.user.id,
      userHandles,
      config.notionToken,
      config.notionPageId,
      config.lastBlockId,
    );

    await prisma.notionSyncState.update({
      where: { userId: session.user.id },
      data: {
        lastSyncAt: new Date(),
        lastBlockId: newLastBlockId,
        lastResult: JSON.stringify(result),
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/notion-messages]", error);
    const message =
      error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── PUT: save config (tests connection first) ──────────────

export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { notionToken, notionPageId, userHandles } = body as {
      notionToken: string;
      notionPageId: string;
      userHandles?: string[];
    };

    if (!notionToken || !notionPageId) {
      return NextResponse.json(
        { error: "Token and page ID are required" },
        { status: 400 },
      );
    }

    const test = await testNotionConnection(notionToken, notionPageId);
    if (!test.ok) {
      return NextResponse.json(
        { error: `Connection failed: ${test.error}` },
        { status: 400 },
      );
    }

    await prisma.notionSyncState.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        notionToken,
        notionPageId,
        userHandles: userHandles ? JSON.stringify(userHandles) : null,
      },
      update: {
        notionToken,
        notionPageId,
        userHandles: userHandles ? JSON.stringify(userHandles) : undefined,
      },
    });

    return NextResponse.json({ ok: true, pageTitle: test.pageTitle });
  } catch (error) {
    console.error("[PUT /api/notion-messages]", error);
    return NextResponse.json(
      { error: "Failed to save config" },
      { status: 500 },
    );
  }
}

// ─── DELETE: disconnect ──────────────────────────────────────

export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await prisma.notionSyncState
      .delete({ where: { userId: session.user.id } })
      .catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/notion-messages]", error);
    return NextResponse.json(
      { error: "Failed to disconnect" },
      { status: 500 },
    );
  }
}
