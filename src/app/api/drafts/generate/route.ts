import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logAIGeneration } from "@/lib/ai-generation-log";
import { getAnthropicSonnetModel } from "@/lib/anthropic-models";
import { generateDraft } from "@/lib/draft-generator";
import {
  buildDraftGenerationFingerprint,
  DRAFT_GENERATION_REUSE_MS,
} from "@/lib/drafts/generation-fingerprint";
import { prisma } from "@/lib/prisma";
import type { DraftTone, DraftContext } from "@/lib/draft-composer-context";
import type { DraftType } from "@/generated/prisma/client";
import {
  RELATIONSHIP_TYPES,
  type RelationshipType,
} from "@/lib/voice/relationship-classifier";

const VALID_TONES: readonly string[] = ["casual", "warm", "professional", "congratulatory", "checking_in"];
const VALID_CONTEXTS: readonly string[] = ["reply_email", "catching_up", "congratulate", "ask", "follow_up"];
const DRAFT_MODEL = getAnthropicSonnetModel();

const CONTEXT_TO_TYPE: Record<string, DraftType> = {
  reply_email: "REPLY_EMAIL",
  catching_up: "CATCHING_UP",
  congratulate: "CONGRATULATE",
  ask: "ASK",
  follow_up: "FOLLOW_UP",
};

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      contactId,
      tone,
      context,
      contextDetail,
      threadSubject,
      threadSnippet,
      threadKey,
      variant,
      relationshipTypeOverride,
    } = body as {
      contactId: string;
      tone: string;
      context: string;
      contextDetail?: string;
      threadSubject?: string;
      threadSnippet?: string;
      threadKey?: string;
      variant?: "quick" | "detailed";
      relationshipTypeOverride?: string;
    };

    if (!contactId || typeof contactId !== "string") {
      return NextResponse.json({ error: "contactId is required" }, { status: 400 });
    }
    if (!tone || !VALID_TONES.includes(tone)) {
      return NextResponse.json({ error: `tone must be one of: ${VALID_TONES.join(", ")}` }, { status: 400 });
    }
    if (!context || !VALID_CONTEXTS.includes(context)) {
      return NextResponse.json({ error: `context must be one of: ${VALID_CONTEXTS.join(", ")}` }, { status: 400 });
    }
    if (
      relationshipTypeOverride !== undefined &&
      !RELATIONSHIP_TYPES.includes(relationshipTypeOverride as RelationshipType)
    ) {
      return NextResponse.json(
        { error: `relationshipTypeOverride must be one of: ${RELATIONSHIP_TYPES.join(", ")}` },
        { status: 400 },
      );
    }

    const selectedVariant = variant === "quick" ? "quick" : "detailed";
    const generationFingerprint = buildDraftGenerationFingerprint({
      surface: "composer",
      contactId,
      tone,
      context,
      contextDetail,
      threadSubject,
      threadSnippet,
      threadKey,
      variant: selectedVariant,
      relationshipTypeOverride,
    });
    const reuseSince = new Date(Date.now() - DRAFT_GENERATION_REUSE_MS);
    const reusableDraft = await prisma.draft.findFirst({
      where: {
        userId: session.user.id,
        generationFingerprint,
        status: "DRAFT",
        createdAt: { gte: reuseSince },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        contactId: true,
        content: true,
        subjectLine: true,
      },
    });

    if (reusableDraft) {
      await logAIGeneration({
        userId: session.user.id,
        feature: "draft",
        model: DRAFT_MODEL,
        inputRefs: [`draft:${reusableDraft.id}`, `contact:${reusableDraft.contactId}`],
        outputId: reusableDraft.id,
        tokensIn: 0,
        tokensOut: 0,
        cacheHit: true,
        latencyMs: 0,
      });

      return NextResponse.json({
        quick: reusableDraft.content,
        detailed: reusableDraft.content,
        subjectLine: reusableDraft.subjectLine,
        resolvedContactId: reusableDraft.contactId,
        draftId: reusableDraft.id,
        reused: true,
      });
    }

    const result = await generateDraft({
      contactId,
      userId: session.user.id,
      tone: tone as DraftTone,
      context: context as DraftContext,
      contextDetail,
      threadSubject,
      threadSnippet,
      threadKey,
      relationshipTypeOverride: relationshipTypeOverride as RelationshipType | undefined,
    });

    // Persist the selected variant (default to detailed) as a Draft record
    const selectedContent = selectedVariant === "quick" ? result.quick : result.detailed;
    const resolvedContactId = result.resolvedContactId ?? contactId;
    const draft = await prisma.draft.create({
      data: {
        userId: session.user.id,
        contactId: resolvedContactId,
        type: CONTEXT_TO_TYPE[context] ?? "CATCHING_UP",
        tone,
        content: selectedContent,
        subjectLine: result.subjectLine,
        threadKey: threadKey || undefined,
        generationFingerprint,
      },
    });

    return NextResponse.json({ ...result, draftId: draft.id });
  } catch (error) {
    console.error("[POST /api/drafts/generate]", error);
    return NextResponse.json(
      {
        error: "Failed to generate draft",
        detail: error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    );
  }
}
