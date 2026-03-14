import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/extension/ping
 * Health check for the Chrome extension.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const contactCount = await prisma.contact.count({
      where: { userId: session.user.id },
    });

    return NextResponse.json({
      ok: true,
      userId: session.user.id,
      contactCount,
    });
  } catch (error) {
    console.error("[GET /api/extension/ping]", error);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
