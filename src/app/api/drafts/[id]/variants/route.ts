import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  parseVersions,
  currentVersion,
} from "@/lib/drafts/workspace-types";
import { buildRefineContext } from "@/lib/drafts/context";
import {
  runVariants,
  VARIANTS_MODEL_NAME,
  type DraftVariant,
} from "@/lib/drafts/variants";
import { logAIGeneration } from "@/lib/ai-generation-log";

const VARIANTS_REUSE_MS = 2 * 60 * 1000;
const MAX_RECENT_VARIANT_RESULTS = 50;

interface VariantRouteResult {
  readonly variants: DraftVariant[];
}

const inFlightVariantRequests = new Map<string, Promise<VariantRouteResult>>();
const recentVariantResults = new Map<
  string,
  { readonly expiresAt: number; readonly result: VariantRouteResult }
>();

/**
 * POST /api/drafts/[id]/variants
 *
 * Returns 3 alternate drafts (shorter, warmer, with-humor) that
 * Jennifer can compare side-by-side. Does NOT mutate the draft —
 * picking a variant calls /version with sourceRequest="variant_pick:<label>".
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const { id } = await params;

    const draft = await prisma.draft.findFirst({
      where: { id, userId },
      select: {
        id: true,
        contactId: true,
        threadKey: true,
        content: true,
        subjectLine: true,
        workspaceVersions: true,
      },
    });
    if (!draft) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const versions = parseVersions(draft.workspaceVersions);
    const current = currentVersion(versions);
    const currentContent = current?.content ?? draft.content;
    const currentSubject = current?.subjectLine ?? draft.subjectLine ?? null;
    const cacheKey = buildVariantCacheKey({
      userId,
      draftId: draft.id,
      currentContent,
      currentSubject,
    });
    const now = Date.now();
    pruneRecentVariantResults(now);

    const cached = recentVariantResults.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      await logVariantCacheHit(userId, draft.id);
      return NextResponse.json({ variants: cached.result.variants, cached: true });
    }

    const existing = inFlightVariantRequests.get(cacheKey);
    if (existing) {
      const result = await existing;
      await logVariantCacheHit(userId, draft.id);
      return NextResponse.json({ variants: result.variants, cached: true });
    }

    const pending = generateVariantResult({
      userId,
      draft,
      currentContent,
      currentSubject,
    });
    inFlightVariantRequests.set(cacheKey, pending);

    try {
      const result = await pending;
      recentVariantResults.set(cacheKey, {
        expiresAt: Date.now() + VARIANTS_REUSE_MS,
        result,
      });
      return NextResponse.json({ variants: result.variants });
    } finally {
      if (inFlightVariantRequests.get(cacheKey) === pending) {
        inFlightVariantRequests.delete(cacheKey);
      }
    }
  } catch (error) {
    console.error("[POST /api/drafts/[id]/variants]", error);
    return NextResponse.json(
      {
        error: "Failed to generate variants",
        detail: error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    );
  }
}

async function generateVariantResult(args: {
  readonly userId: string;
  readonly draft: {
    readonly id: string;
    readonly contactId: string;
    readonly threadKey: string | null;
  };
  readonly currentContent: string;
  readonly currentSubject: string | null;
}): Promise<VariantRouteResult> {
  const context = await buildRefineContext({
    prisma,
    userId: args.userId,
    contactId: args.draft.contactId,
    threadKey: args.draft.threadKey,
    queryText: args.currentContent.slice(0, 600),
  });

  const startedAt = Date.now();
  const result = await runVariants({
    currentDraft: args.currentContent,
    currentSubjectLine: args.currentSubject,
    context,
  });
  await logAIGeneration({
    userId: args.userId,
    feature: "draft_variants",
    model: VARIANTS_MODEL_NAME,
    inputRefs: [
      `draft:${args.draft.id}`,
      ...context.references.map((r) => `voiceReference:${r.id}`),
    ],
    outputId: args.draft.id,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs: Date.now() - startedAt,
  });

  return { variants: result.variants };
}

function buildVariantCacheKey(args: {
  readonly userId: string;
  readonly draftId: string;
  readonly currentContent: string;
  readonly currentSubject: string | null;
}) {
  return createHash("sha256")
    .update(args.userId)
    .update("\0")
    .update(args.draftId)
    .update("\0")
    .update(args.currentSubject ?? "")
    .update("\0")
    .update(args.currentContent)
    .digest("hex");
}

async function logVariantCacheHit(userId: string, draftId: string) {
  await logAIGeneration({
    userId,
    feature: "draft_variants",
    model: VARIANTS_MODEL_NAME,
    inputRefs: [`draft:${draftId}`],
    outputId: draftId,
    tokensIn: 0,
    tokensOut: 0,
    cacheHit: true,
    latencyMs: 0,
  });
}

function pruneRecentVariantResults(now: number) {
  for (const [key, value] of recentVariantResults) {
    if (value.expiresAt <= now) {
      recentVariantResults.delete(key);
    }
  }

  while (recentVariantResults.size > MAX_RECENT_VARIANT_RESULTS) {
    const oldestKey = recentVariantResults.keys().next().value as string | undefined;
    if (!oldestKey) return;
    recentVariantResults.delete(oldestKey);
  }
}
