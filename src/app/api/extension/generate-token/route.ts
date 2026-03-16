import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";
import { hashToken } from "@/lib/extension-auth";

/**
 * POST /api/extension/generate-token
 * Generate a new bearer token for the Chrome extension.
 * Requires an active session (cookie auth).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const label = typeof body.label === "string" ? body.label.slice(0, 100) : "Extension";

  // Generate a cryptographically secure token
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  await prisma.extensionToken.create({
    data: {
      userId: session.user.id,
      tokenHash,
      label,
    },
  });

  // Return the raw token ONCE — it cannot be retrieved again
  return NextResponse.json({
    token: rawToken,
    label,
    message: "Save this token — it will not be shown again.",
  });
}

/**
 * GET /api/extension/generate-token
 * List existing tokens (without revealing the actual token).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokens = await prisma.extensionToken.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      label: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ tokens });
}

/**
 * DELETE /api/extension/generate-token
 * Revoke a token by ID.
 */
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const tokenId = typeof body.id === "string" ? body.id : null;

  if (!tokenId) {
    return NextResponse.json({ error: "Token ID required" }, { status: 400 });
  }

  await prisma.extensionToken.deleteMany({
    where: { id: tokenId, userId: session.user.id },
  });

  return NextResponse.json({ ok: true });
}
