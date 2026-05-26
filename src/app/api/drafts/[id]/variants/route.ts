import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  parseVersions,
  currentVersion,
} from "@/lib/drafts/workspace-types";
import { buildRefineContext } from "@/lib/drafts/context";
import { runVariants, VARIANTS_MODEL_NAME } from "@/lib/drafts/variants";
import { logAIGeneration } from "@/lib/ai-generation-log";

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

    const context = await buildRefineContext({
      prisma,
      userId,
      contactId: draft.contactId,
      threadKey: draft.threadKey,
      queryText: currentContent.slice(0, 600),
    });

    const startedAt = Date.now();
    const result = await runVariants({
      currentDraft: currentContent,
      currentSubjectLine: currentSubject,
      context,
    });
    await logAIGeneration({
      userId,
      feature: "draft_variants",
      model: VARIANTS_MODEL_NAME,
      inputRefs: [
        `draft:${draft.id}`,
        ...context.references.map((r) => `voiceReference:${r.id}`),
      ],
      outputId: draft.id,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      latencyMs: Date.now() - startedAt,
    });

    return NextResponse.json({ variants: result.variants });
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
