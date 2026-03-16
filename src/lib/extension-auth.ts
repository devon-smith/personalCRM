import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";
import { NextResponse } from "next/server";

// ─── Rate Limiting (in-memory, per-process) ─────────────────

interface RateLimitEntry {
  readonly count: number;
  readonly resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  rateLimitMap.set(key, { ...entry, count: entry.count + 1 });
  return true;
}

// Stale entries are cleaned lazily in checkRateLimit (expired entries get overwritten)

// ─── Token hashing ──────────────────────────────────────────

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ─── Extension auth: session-first, bearer-token fallback ───

interface AuthResult {
  readonly userId: string;
}

/**
 * Authenticate an extension API request.
 * 1. Try NextAuth session cookie (works on localhost).
 * 2. Fall back to Bearer token from Authorization header.
 * Returns userId on success, or a NextResponse error to return immediately.
 */
export async function authExtension(
  req: Request,
): Promise<AuthResult | NextResponse> {
  // 1. Try session auth first
  const session = await auth();
  if (session?.user?.id) {
    if (!checkRateLimit(`session:${session.user.id}`)) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 },
      );
    }
    return { userId: session.user.id };
  }

  // 2. Try bearer token
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  if (!token || token.length < 32) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const tokenHash = hashToken(token);
  const extensionToken = await prisma.extensionToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true },
  });

  if (!extensionToken) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  if (!checkRateLimit(`token:${extensionToken.id}`)) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 },
    );
  }

  // Update lastUsedAt in background (fire and forget)
  prisma.extensionToken
    .update({
      where: { id: extensionToken.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return { userId: extensionToken.userId };
}
