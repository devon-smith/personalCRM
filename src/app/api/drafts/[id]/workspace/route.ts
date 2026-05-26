import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  parseVersions,
  parseChat,
  currentVersion,
} from "@/lib/drafts/workspace-types";
import { loadReplyContext } from "@/lib/draft-reply-context";
import { getVoiceReferences } from "@/lib/voice/references/retrieval";
import { classifyRecipient } from "@/lib/voice/relationship-classifier";

/**
 * GET /api/drafts/[id]/workspace
 *
 * Returns the full state the workspace page needs to render: the
 * draft row, version history, refinement chat, and a snapshot of
 * the context Claude would use (recipient, inbound message, voice
 * references). The context snapshot is read-only — it doesn't
 * gate refinement, just informs the left-column display.
 */
export async function GET(
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
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
            role: true,
            tier: true,
            linkedinUrl: true,
            lastInteraction: true,
          },
        },
      },
    });
    if (!draft) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const versions = parseVersions(draft.workspaceVersions);
    const chat = parseChat(draft.refinementChat);

    // Reply context — only when this draft has a thread.
    const replyContext = draft.threadKey
      ? await loadReplyContext({
          prisma,
          userId,
          threadKey: draft.threadKey,
        }).catch(() => null)
      : null;

    // Voice references — same retrieval as the generator. We pass
    // null embedding (no semantic ranking at view-time; the workspace
    // just shows what's available, refinement re-ranks).
    const relationshipType = draft.contact.email
      ? await classifyRecipient({
          prisma,
          userId,
          recipientEmail: draft.contact.email,
        }).catch(() => "unknown" as const)
      : "unknown";

    const references = await getVoiceReferences({
      prisma,
      userId,
      queryEmbeddingLiteral: null,
      relationshipType,
    }).catch(() => []);

    // Memory summary — short pull, just for display.
    const memory = await prisma.contactMemory.findUnique({
      where: { contactId: draft.contact.id },
      select: {
        personalContext: true,
        recurringThemes: true,
        openThreads: true,
      },
    });

    const current = currentVersion(versions);

    return NextResponse.json({
      draft: {
        id: draft.id,
        contactId: draft.contactId,
        type: draft.type,
        tone: draft.tone,
        content: current?.content ?? draft.content,
        subjectLine: current?.subjectLine ?? draft.subjectLine,
        status: draft.status,
        threadKey: draft.threadKey,
        isWorkspaceDraft: draft.isWorkspaceDraft,
        inboxItemId: draft.inboxItemId,
        gmailDraftId: draft.gmailDraftId,
        createdAt: draft.createdAt.toISOString(),
        updatedAt: draft.updatedAt.toISOString(),
      },
      versions,
      chat,
      context: {
        contact: {
          id: draft.contact.id,
          name: draft.contact.name,
          email: draft.contact.email,
          company: draft.contact.company,
          role: draft.contact.role,
          tier: draft.contact.tier,
          lastInteractionAt: draft.contact.lastInteraction
            ? draft.contact.lastInteraction.toISOString()
            : null,
        },
        relationshipType,
        replyContext: replyContext
          ? {
              latestInbound: {
                fromEmail: replyContext.latestInbound.fromEmail,
                fromName: replyContext.latestInbound.fromName,
                subject: replyContext.latestInbound.subject,
                body: replyContext.latestInbound.body,
                bodyIsFull: replyContext.latestInbound.bodyIsFull,
                occurredAt:
                  replyContext.latestInbound.occurredAt.toISOString(),
              },
              threadHistory: replyContext.threadHistory.map((m) => ({
                direction: m.direction,
                fromEmail: m.fromEmail,
                fromName: m.fromName,
                subject: m.subject,
                snippet: m.snippet,
                occurredAt: m.occurredAt.toISOString(),
              })),
            }
          : null,
        memory: memory
          ? {
              personalContext: memory.personalContext,
              recurringThemes: memory.recurringThemes,
              openThreads: Array.isArray(memory.openThreads)
                ? memory.openThreads
                : [],
            }
          : null,
        references: references.map((r) => ({
          id: r.id,
          filename: r.filename,
          sourceType: r.sourceType,
          toneNotes: r.guidance?.toneNotes ?? "",
        })),
      },
    });
  } catch (error) {
    console.error("[GET /api/drafts/[id]/workspace]", error);
    return NextResponse.json(
      { error: "Failed to load workspace" },
      { status: 500 },
    );
  }
}
