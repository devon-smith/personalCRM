import { NextResponse } from "next/server";
import { authExtension } from "@/lib/extension-auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/extension/ping
 * Health check for the Chrome extension.
 */
export async function GET(request: Request) {
  try {
    const authResult = await authExtension(request);
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.userId;

    const contactCount = await prisma.contact.count({
      where: { userId },
    });

    return NextResponse.json({
      ok: true,
      userId,
      contactCount,
    });
  } catch (error) {
    console.error("[GET /api/extension/ping]", error);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
