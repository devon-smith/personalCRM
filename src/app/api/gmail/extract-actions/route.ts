import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  extractActionItems,
  type GmailChangedThreadRef,
} from "@/lib/gmail/extract-actions";

const MAX_CHANGED_THREADS = 50;

function parseChangedThreads(input: unknown): GmailChangedThreadRef[] {
  if (!Array.isArray(input)) return [];

  const changedThreads: GmailChangedThreadRef[] = [];
  const seen = new Set<string>();

  for (const item of input) {
    if (typeof item !== "object" || item === null) continue;
    const candidate = item as { accountId?: unknown; threadId?: unknown };
    if (typeof candidate.accountId !== "string") continue;
    if (typeof candidate.threadId !== "string") continue;

    const accountId = candidate.accountId.trim();
    const threadId = candidate.threadId.trim();
    if (!accountId || !threadId) continue;

    const key = `${accountId}:${threadId}`;
    if (seen.has(key)) continue;

    seen.add(key);
    changedThreads.push({ accountId, threadId });
    if (changedThreads.length >= MAX_CHANGED_THREADS) break;
  }

  return changedThreads;
}

/**
 * POST /api/gmail/extract-actions
 * Run AI extraction on Gmail threads touched by the sync that just ran.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      changedThreads?: unknown;
    } | null;
    const changedThreads = parseChangedThreads(body?.changedThreads);
    if (changedThreads.length === 0) {
      return NextResponse.json(
        { error: "changedThreads is required; run Gmail sync before extraction" },
        { status: 400 },
      );
    }

    const result = await extractActionItems(session.user.id, { changedThreads });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/gmail/extract-actions]", error);
    return NextResponse.json(
      { error: "Failed to extract email actions" },
      { status: 500 },
    );
  }
}
