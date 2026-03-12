import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateDraft } from "@/lib/draft-generator";
import type { DraftTone, DraftContext } from "@/lib/draft-composer-context";

const VALID_TONES: readonly string[] = ["casual", "warm", "professional", "congratulatory", "checking_in"];
const VALID_CONTEXTS: readonly string[] = ["reply_email", "catching_up", "congratulate", "ask", "follow_up"];

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { contactId, tone, context, contextDetail, threadSubject, threadSnippet } = body as {
      contactId: string;
      tone: string;
      context: string;
      contextDetail?: string;
      threadSubject?: string;
      threadSnippet?: string;
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

    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/drafts/generate]", error);
    return NextResponse.json(
      { error: "Failed to generate draft" },
      { status: 500 },
    );
  }
}
