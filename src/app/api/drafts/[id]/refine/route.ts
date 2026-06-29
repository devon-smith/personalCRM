import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  parseVersions,
  parseChat,
  currentVersion,
  nextVersionNumber,
  type WorkspaceVersion,
  type RefinementChatMessage,
} from "@/lib/drafts/workspace-types";
import {
  runRefinementStream,
  REFINE_MODEL_NAME,
} from "@/lib/drafts/refine";
import { buildRefineContext } from "@/lib/drafts/context";
import { logAIGeneration } from "@/lib/ai-generation-log";

const inFlightDraftRefinements = new Set<string>();

/**
 * POST /api/drafts/[id]/refine?stream=1
 *
 * Streams the refinement response as Server-Sent Events:
 *   event: text_delta  data: { text }
 *   event: complete    data: { version: WorkspaceVersion, note: string }
 *   event: error       data: { message }
 *
 * On completion the new version + chat turns are persisted to the
 * Draft row before the `complete` event fires — clients can refetch
 * /workspace and see the same state.
 *
 * Body: { userRequest: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const body = await req.json().catch(() => ({})) as { userRequest?: string };
  const userRequest =
    typeof body.userRequest === "string" ? body.userRequest.trim() : "";
  if (!userRequest) {
    return NextResponse.json(
      { error: "userRequest required" },
      { status: 400 },
    );
  }
  if (userRequest.length > 2000) {
    return NextResponse.json(
      { error: "userRequest too long (max 2000 chars)" },
      { status: 400 },
    );
  }

  const draft = await prisma.draft.findFirst({
    where: { id, userId },
    select: {
      id: true,
      userId: true,
      contactId: true,
      threadKey: true,
      content: true,
      subjectLine: true,
      workspaceVersions: true,
      refinementChat: true,
    },
  });
  if (!draft) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const versions = parseVersions(draft.workspaceVersions);
  const chat = parseChat(draft.refinementChat);
  const current = currentVersion(versions);
  const currentContent = current?.content ?? draft.content;
  const currentSubject = current?.subjectLine ?? draft.subjectLine ?? null;
  const refinementKey = `${userId}:${draft.id}`;
  if (inFlightDraftRefinements.has(refinementKey)) {
    return NextResponse.json(
      { error: "A refinement is already in progress for this draft" },
      { status: 409 },
    );
  }
  inFlightDraftRefinements.add(refinementKey);

  // Build context up-front — we want a snapshot from BEFORE the
  // stream starts so the SSE flow stays purely about token delivery.
  let context;
  try {
    context = await buildRefineContext({
      prisma,
      userId,
      contactId: draft.contactId,
      threadKey: draft.threadKey,
      // Bias reference retrieval toward the user's intent so quick
      // requests like "more humor" pull humor-heavy refs to the top.
      queryText: `${currentContent.slice(0, 600)} ${userRequest}`,
    });
  } catch (err) {
    inFlightDraftRefinements.delete(refinementKey);
    return NextResponse.json(
      {
        error: "Couldn't load draft context",
        detail: err instanceof Error ? err.message : undefined,
      },
      { status: 500 },
    );
  }

  return streamResponse({
    userId,
    draftId: draft.id,
    userRequest,
    currentContent,
    currentSubject,
    chat,
    versions,
    context,
    refinementKey,
  });
}

interface StreamArgs {
  userId: string;
  draftId: string;
  userRequest: string;
  currentContent: string;
  currentSubject: string | null;
  chat: RefinementChatMessage[];
  versions: WorkspaceVersion[];
  context: Awaited<ReturnType<typeof buildRefineContext>>;
  refinementKey: string;
}

function streamResponse(args: StreamArgs): Response {
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const body = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      try {
        for await (const ev of runRefinementStream({
          currentDraft: args.currentContent,
          currentSubjectLine: args.currentSubject,
          userRequest: args.userRequest,
          chatHistory: args.chat,
          priorVersions: args.versions,
          context: args.context,
        })) {
          if (ev.type === "text_delta") {
            send("text_delta", { text: ev.text });
            continue;
          }
          if (ev.type === "error") {
            send("error", { message: ev.message });
            await logAIGeneration({
              userId: args.userId,
              feature: "draft_refine",
              model: REFINE_MODEL_NAME,
              inputRefs: [`draft:${args.draftId}`],
              error: ev.message,
              latencyMs: Date.now() - startedAt,
            });
            continue;
          }

          // Complete — persist the new version + chat turns, then
          // emit the final event with the saved version row.
          const versionNumber = nextVersionNumber(args.versions);
          const newVersion: WorkspaceVersion = {
            version: versionNumber,
            content: ev.content,
            subjectLine: ev.subjectLine,
            generatedAt: new Date().toISOString(),
            sourceRequest: args.userRequest,
            source: "refinement",
            tokensIn: ev.tokensIn,
            tokensOut: ev.tokensOut,
          };
          const newUserTurn: RefinementChatMessage = {
            role: "user",
            content: args.userRequest,
            timestamp: new Date().toISOString(),
          };
          const newAssistantTurn: RefinementChatMessage = {
            role: "assistant",
            content: ev.assistantNote,
            timestamp: new Date().toISOString(),
            versionId: versionNumber,
          };
          const nextVersions = [...args.versions, newVersion];
          const nextChat = [...args.chat, newUserTurn, newAssistantTurn];

          await prisma.draft.update({
            where: { id: args.draftId },
            data: {
              content: ev.content,
              subjectLine: ev.subjectLine,
              workspaceVersions: nextVersions as unknown as object,
              refinementChat: nextChat as unknown as object,
            },
          });

          await logAIGeneration({
            userId: args.userId,
            feature: "draft_refine",
            model: REFINE_MODEL_NAME,
            inputRefs: [
              `draft:${args.draftId}`,
              ...args.context.references.map((r) => `voiceReference:${r.id}`),
            ],
            outputId: args.draftId,
            tokensIn: ev.tokensIn,
            tokensOut: ev.tokensOut,
            latencyMs: Date.now() - startedAt,
          });

          send("complete", {
            version: newVersion,
            note: ev.assistantNote,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send("error", { message: msg });
      } finally {
        inFlightDraftRefinements.delete(args.refinementKey);
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
