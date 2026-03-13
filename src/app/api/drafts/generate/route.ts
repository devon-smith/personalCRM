import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateDraft } from "@/lib/draft-generator";
import { prisma } from "@/lib/prisma";
import type { DraftTone, DraftContext } from "@/lib/draft-composer-context";
import type { DraftType } from "@/generated/prisma/client";

const VALID_TONES: readonly string[] = ["casual", "warm", "professional", "congratulatory", "checking_in"];
const VALID_CONTEXTS: readonly string[] = ["reply_email", "catching_up", "congratulate", "ask", "follow_up"];

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
    const { contactId, tone, context, contextDetail, threadSubject, threadSnippet, variant } = body as {
      contactId: string;
      tone: string;
      context: string;
      contextDetail?: string;
      threadSubject?: string;
      threadSnippet?: string;
      variant?: "quick" | "detailed";
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

    const result = await generateDraft({
      contactId,
      userId: session.user.id,
      tone: tone as DraftTone,
      context: context as DraftContext,
      contextDetail,
      threadSubject,
      threadSnippet,
    });

    // Persist the selected variant (default to detailed) as a Draft record
    const selectedContent = variant === "quick" ? result.quick : result.detailed;
    const draft = await prisma.draft.create({
      data: {
        userId: session.user.id,
        contactId,
        type: CONTEXT_TO_TYPE[context] ?? "CATCHING_UP",
        tone,
        content: selectedContent,
        subjectLine: result.subjectLine,
      },
    });

    return NextResponse.json({ ...result, draftId: draft.id });
  } catch (error) {
    console.error("[POST /api/drafts/generate]", error);
    return NextResponse.json(
      { error: "Failed to generate draft" },
      { status: 500 },
    );
  }
}
