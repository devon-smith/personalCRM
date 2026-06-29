import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findDraftQualityIssues, generateDraft } from "@/lib/draft-generator";
import type { DraftTone, DraftContext } from "@/lib/draft-composer-context";
import type { DraftType } from "@/generated/prisma/client";
import type { WorkspaceVersion } from "@/lib/drafts/workspace-types";

/**
 * POST /api/drafts/workspace/new
 *
 * Creates a new workspace-mode Draft row + generates the initial v1
 * using the existing draft-generator (voice context, reply context,
 * memory all apply as before). Returns the new draft id so the
 * /drafts/new/compose page can redirect to /drafts/[id]/compose.
 *
 * Body: { contactId, tone?, context?, threadKey?, inboxItemId? }
 * If inboxItemId already has a draft, returns that draft id instead
 * of generating a duplicate.
 */
const CONTEXT_TO_TYPE: Record<DraftContext, DraftType> = {
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
    const userId = session.user.id;

    const body = await req.json().catch(() => ({})) as {
      contactId?: string;
      tone?: DraftTone;
      context?: DraftContext;
      threadKey?: string;
      inboxItemId?: string;
    };

    let contactId = body.contactId;
    let threadKey = body.threadKey ?? null;

    // Resolve inboxItemId → contactId + threadKey if the caller only
    // gave us an inbox item id (the "Draft reply" entry point does).
    if (body.inboxItemId && !contactId) {
      const item = await prisma.inboxItem.findFirst({
        where: { id: body.inboxItemId, userId },
        select: { contactId: true, threadKey: true },
      });
      if (!item) {
        return NextResponse.json(
          { error: "Inbox item not found" },
          { status: 404 },
        );
      }
      contactId = item.contactId;
      if (!threadKey) threadKey = item.threadKey ?? null;
    }

    if (!contactId) {
      return NextResponse.json(
        { error: "contactId or inboxItemId required" },
        { status: 400 },
      );
    }

    let staleExistingDraftId: string | null = null;
    if (body.inboxItemId) {
      const existing = await prisma.draft.findFirst({
        where: { userId, inboxItemId: body.inboxItemId },
        select: { id: true, content: true },
      });
      if (existing) {
        const issues = findDraftQualityIssues(
          { quick: existing.content, detailed: existing.content },
          { context: "catching_up", replyContext: null },
        );
        if (issues.length === 0) {
          return NextResponse.json({ id: existing.id, existing: true });
        }
        staleExistingDraftId = existing.id;
      }
    }

    const tone: DraftTone = body.tone ?? "warm";
    const context: DraftContext =
      body.context ?? (threadKey ? "reply_email" : "catching_up");

    // Generate v1 using the existing pipeline. Inline rather than
    // queued — Jennifer's waiting on this page render and there's
    // no batching benefit.
    const result = await generateDraft({
      contactId,
      userId,
      tone,
      context,
      threadKey: threadKey ?? undefined,
    });

    const initialVersion: WorkspaceVersion = {
      version: 1,
      content: result.detailed,
      subjectLine: result.subjectLine,
      generatedAt: new Date().toISOString(),
      sourceRequest: "initial generation",
      source: "initial",
    };
    const resolvedContactId = result.resolvedContactId ?? contactId;

    const draftData = {
      userId,
      contactId: resolvedContactId,
      type: CONTEXT_TO_TYPE[context] ?? "CATCHING_UP",
      tone,
      content: result.detailed,
      subjectLine: result.subjectLine,
      isWorkspaceDraft: true,
      threadKey: threadKey ?? undefined,
      inboxItemId: body.inboxItemId ?? undefined,
      workspaceVersions: [initialVersion] as unknown as object,
      refinementChat: [] as unknown as object,
    };

    const draft = staleExistingDraftId
      ? await prisma.draft.update({
          where: { id: staleExistingDraftId },
          data: {
            contactId: resolvedContactId,
            type: draftData.type,
            tone,
            content: result.detailed,
            subjectLine: result.subjectLine,
            isWorkspaceDraft: true,
            threadKey: threadKey ?? undefined,
            workspaceVersions: [initialVersion] as unknown as object,
            refinementChat: [] as unknown as object,
            gmailDraftId: null,
            gmailThreadId: null,
            inReplyToMessageId: null,
            recipientEmail: null,
            savedToGmailAt: null,
          },
          select: { id: true },
        })
      : await prisma.draft.create({
          data: draftData,
          select: { id: true },
        });

    return NextResponse.json({
      id: draft.id,
      existing: false,
      regenerated: Boolean(staleExistingDraftId),
    });
  } catch (error) {
    console.error("[POST /api/drafts/workspace/new]", error);
    return NextResponse.json(
      {
        error: "Failed to create workspace draft",
        detail: error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    );
  }
}
