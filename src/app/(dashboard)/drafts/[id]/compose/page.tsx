"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Loader2,
  Send,
  Save,
  Sparkles,
  GitBranch,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  History,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import {
  REFINEMENT_QUICK_ACTIONS,
  type WorkspaceVersion,
  type RefinementChatMessage,
} from "@/lib/drafts/workspace-types";
import { DiffOverlay } from "@/components/drafts/diff-overlay";

/**
 * /drafts/[id]/compose — iterative draft workspace (M0.x.6).
 *
 * Three columns: context (left) · draft editor + history (center) ·
 * refinement chat (right). Streaming refinement updates the editor
 * in real time; manual edits persist on blur; variants opens a
 * comparison drawer.
 */

interface DraftRow {
  id: string;
  contactId: string;
  type: string;
  tone: string;
  content: string;
  subjectLine: string | null;
  status: string;
  threadKey: string | null;
  isWorkspaceDraft: boolean;
  inboxItemId: string | null;
  gmailDraftId: string | null;
}

interface ContactSnapshot {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  tier: string;
  lastInteractionAt: string | null;
}

interface ReplyContextSnapshot {
  latestInbound: {
    fromEmail: string;
    fromName: string | null;
    subject: string | null;
    body: string;
    bodyIsFull: boolean;
    occurredAt: string;
  };
  threadHistory: Array<{
    direction: string;
    fromEmail: string;
    fromName: string | null;
    subject: string | null;
    snippet: string | null;
    occurredAt: string;
  }>;
}

interface MemorySnapshot {
  personalContext: unknown;
  recurringThemes: string[];
  openThreads: unknown[];
}

interface ReferenceSnapshot {
  id: string;
  filename: string;
  sourceType: string;
  toneNotes: string;
}

interface WorkspaceResponse {
  draft: DraftRow;
  versions: WorkspaceVersion[];
  chat: RefinementChatMessage[];
  context: {
    contact: ContactSnapshot;
    relationshipType: string;
    replyContext: ReplyContextSnapshot | null;
    memory: MemorySnapshot | null;
    references: ReferenceSnapshot[];
  };
}

interface DraftVariant {
  label: string;
  title: string;
  content: string;
  subjectLine: string | null;
}

export default function ComposePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const qc = useQueryClient();
  const router = useRouter();

  const { data, isLoading, error } = useQuery<WorkspaceResponse>({
    queryKey: ["draft-workspace", id],
    queryFn: async () => {
      const res = await fetch(`/api/drafts/${id}/workspace`);
      if (!res.ok) throw new Error("Failed to load workspace");
      return res.json();
    },
    refetchOnWindowFocus: false,
  });

  // Local editor state — initialized from the loaded draft, mutated
  // by streaming refinement (live), variants (on pick), and manual
  // typing. Persisted via /version POST on blur.
  const [editorContent, setEditorContent] = useState("");
  const [editorSubject, setEditorSubject] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyOpenVersion, setHistoryOpenVersion] = useState<number | null>(
    null,
  );
  const [variants, setVariants] = useState<DraftVariant[] | null>(null);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [composerInput, setComposerInput] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const baselineRef = useRef<string>("");

  // Sync local editor state with the loaded draft. Re-runs only when
  // the draft id changes or the server-side current content drifts
  // (e.g. after a refinement persists). This is a setState-in-effect
  // on purpose: contenteditable needs local state for the cursor,
  // and a key-based remount would discard in-flight streaming
  // updates from the parent.
  useEffect(() => {
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditorContent(data.draft.content);
    setEditorSubject(data.draft.subjectLine);
    baselineRef.current = data.draft.content;
  }, [data]);

  // ─── Mutations ─────────────────────────────────────────────

  const saveVersion = useMutation({
    mutationFn: async (args: {
      content: string;
      subjectLine: string | null;
      sourceRequest: string;
      source: "manual_edit" | "variant_pick";
    }) => {
      const res = await fetch(`/api/drafts/${id}/version`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["draft-workspace", id] });
    },
    onError: () => toast.error("Couldn't save"),
  });

  const sendToGmail = useMutation({
    mutationFn: async () => {
      const recipientEmail = data?.context.contact.email;
      if (!recipientEmail) throw new Error("No email on file for this contact");
      const res = await fetch(`/api/drafts/${id}/save-to-gmail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientEmail,
          isReply: !!data?.draft.threadKey,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Gmail save failed");
      }
      return res.json() as Promise<{ deepLink: string }>;
    },
    onSuccess: (result) => {
      toast.success("Saved to Gmail");
      window.open(result.deepLink, "_blank", "noopener,noreferrer");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Gmail save failed");
    },
  });

  // ─── Streaming refinement ──────────────────────────────────

  const handleRefine = useCallback(
    async (userRequest: string) => {
      const trimmed = userRequest.trim();
      if (!trimmed || isRefining) return;
      setIsRefining(true);
      setStreamingContent("");
      try {
        const res = await fetch(`/api/drafts/${id}/refine?stream=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userRequest: trimmed }),
        });
        if (!res.ok || !res.body) {
          throw new Error(`Refinement failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const lines = part.split("\n");
            const eventLine = lines.find((l) => l.startsWith("event: "));
            const dataLine = lines.find((l) => l.startsWith("data: "));
            if (!eventLine || !dataLine) continue;
            const event = eventLine.slice("event: ".length).trim();
            const payload = JSON.parse(
              dataLine.slice("data: ".length),
            ) as Record<string, unknown>;
            if (event === "text_delta") {
              accumulated += payload.text as string;
              // The model's streamed text is the raw JSON; we display
              // a friendly "thinking" indicator until the content
              // field can be parsed cleanly. For incremental display
              // we extract the partial content string when we see
              // the opening `"content":"`.
              const idx = accumulated.indexOf('"content":"');
              if (idx >= 0) {
                const partial = parsePartialContent(
                  accumulated.slice(idx + '"content":"'.length),
                );
                setStreamingContent(partial);
              }
            } else if (event === "complete") {
              const newVer = payload.version as WorkspaceVersion;
              setEditorContent(newVer.content);
              setEditorSubject(newVer.subjectLine);
              baselineRef.current = newVer.content;
              setStreamingContent(null);
              qc.invalidateQueries({ queryKey: ["draft-workspace", id] });
            } else if (event === "error") {
              throw new Error(
                (payload.message as string) ?? "Refinement error",
              );
            }
          }
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Refinement failed",
        );
        setStreamingContent(null);
      } finally {
        setIsRefining(false);
      }
    },
    [id, isRefining, qc],
  );

  const handleVariants = useCallback(async () => {
    setLoadingVariants(true);
    try {
      const res = await fetch(`/api/drafts/${id}/variants`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Variants failed");
      const json = (await res.json()) as { variants: DraftVariant[] };
      setVariants(json.variants);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Variants failed");
    } finally {
      setLoadingVariants(false);
    }
  }, [id]);

  // ─── Manual edit persistence ───────────────────────────────

  const handleEditorBlur = useCallback(() => {
    const current = editorRef.current?.innerText ?? "";
    if (current === baselineRef.current) return;
    // Skip auto-save while a refinement is streaming — that would
    // race with the new version write.
    if (isRefining) return;
    saveVersion.mutate({
      content: current,
      subjectLine: editorSubject,
      sourceRequest: "Manual edit",
      source: "manual_edit",
    });
    baselineRef.current = current;
  }, [editorSubject, isRefining, saveVersion]);

  // ─── Render ────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--text-tertiary)" }} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>
          Couldn&rsquo;t load this draft workspace.
        </p>
      </div>
    );
  }

  const displayedContent = streamingContent ?? editorContent;
  const versions = data.versions;
  const previousVersion =
    versions.length >= 2 ? versions[versions.length - 2] : null;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Top bar */}
      <div
        className="flex items-center justify-between border-b px-4 py-2.5"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
        }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1 text-[12px]"
            style={{ color: "var(--text-tertiary)" }}
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>
          <div
            className="h-4 w-px"
            style={{ backgroundColor: "var(--border)" }}
          />
          <div className="flex items-center gap-2">
            <Wand2 className="h-3.5 w-3.5" style={{ color: "var(--text-tertiary)" }} />
            <span
              className="text-[13px] font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              Draft workspace
            </span>
            <span
              className="text-[11.5px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              v{versions.length} · {versions.length === 1 ? "initial" : "iterating"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {previousVersion && (
            <button
              onClick={() => setShowDiff((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-medium"
              style={{
                backgroundColor: showDiff ? "var(--accent-soft)" : "transparent",
                color: showDiff ? "var(--accent-color)" : "var(--text-tertiary)",
                border: "1px solid var(--border)",
              }}
            >
              <GitBranch className="h-3 w-3" />
              {showDiff ? "Hide changes" : "Show changes"}
            </button>
          )}
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-medium"
            style={{
              backgroundColor: showHistory ? "var(--accent-soft)" : "transparent",
              color: showHistory ? "var(--accent-color)" : "var(--text-tertiary)",
              border: "1px solid var(--border)",
            }}
          >
            <History className="h-3 w-3" />
            History ({versions.length})
          </button>
          <button
            onClick={() => handleVariants()}
            disabled={loadingVariants}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-medium"
            style={{
              backgroundColor: "transparent",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            {loadingVariants ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Variants
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left column — Context */}
        <aside
          className="hidden lg:flex flex-col w-72 shrink-0 overflow-y-auto border-r"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface-sunken)",
          }}
        >
          <ContextPanel ctx={data.context} />
        </aside>

        {/* Center column — Draft editor */}
        <section className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-6 space-y-4">
            {/* Recipient + subject */}
            <div>
              <p
                className="text-[11px] uppercase font-semibold tracking-wider mb-1"
                style={{ color: "var(--text-tertiary)" }}
              >
                To
              </p>
              <p
                className="text-[14px] font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                {data.context.contact.name}
                {data.context.contact.email && (
                  <span
                    className="ml-2 text-[12px] font-normal"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    &lt;{data.context.contact.email}&gt;
                  </span>
                )}
              </p>
            </div>
            {editorSubject !== null && (
              <div>
                <p
                  className="text-[11px] uppercase font-semibold tracking-wider mb-1"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Subject
                </p>
                <input
                  value={editorSubject ?? ""}
                  onChange={(e) => setEditorSubject(e.target.value)}
                  onBlur={handleEditorBlur}
                  className="w-full rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-[14px]"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: "var(--surface)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>
            )}
            <div>
              <p
                className="text-[11px] uppercase font-semibold tracking-wider mb-1"
                style={{ color: "var(--text-tertiary)" }}
              >
                Draft
              </p>
              {showDiff && previousVersion ? (
                <div
                  className="rounded-[var(--radius-md)] border px-4 py-3"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: "var(--surface)",
                  }}
                >
                  <DiffOverlay
                    previous={previousVersion.content}
                    current={displayedContent}
                  />
                </div>
              ) : (
                <div
                  ref={editorRef}
                  contentEditable={!isRefining}
                  suppressContentEditableWarning
                  onBlur={handleEditorBlur}
                  className="rounded-[var(--radius-md)] border px-4 py-3 outline-none whitespace-pre-wrap min-h-[200px]"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: "var(--surface)",
                    color: isRefining
                      ? "var(--text-secondary)"
                      : "var(--text-primary)",
                    fontFamily:
                      "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                    fontSize: 14,
                    lineHeight: 1.6,
                  }}
                >
                  {displayedContent}
                </div>
              )}
              <p
                className="mt-1.5 text-[11px]"
                style={{ color: "var(--text-tertiary)" }}
              >
                {wordCount(displayedContent)} words · ~
                {Math.max(1, Math.round(wordCount(displayedContent) / 200))}{" "}
                min read
                {isRefining && (
                  <span className="ml-2">
                    <Loader2
                      className="inline h-3 w-3 animate-spin"
                      style={{ color: "var(--accent-color)" }}
                    />{" "}
                    refining&hellip;
                  </span>
                )}
              </p>
            </div>

            {/* Variants panel */}
            {variants && variants.length > 0 && (
              <VariantsPanel
                variants={variants}
                onPick={(v) => {
                  setEditorContent(v.content);
                  setEditorSubject(v.subjectLine);
                  baselineRef.current = v.content;
                  setVariants(null);
                  saveVersion.mutate({
                    content: v.content,
                    subjectLine: v.subjectLine,
                    sourceRequest: `Picked variant: ${v.title}`,
                    source: "variant_pick",
                  });
                }}
                onClose={() => setVariants(null)}
              />
            )}

            {/* Version history */}
            {showHistory && (
              <VersionHistoryPanel
                versions={versions}
                openVersion={historyOpenVersion}
                onOpen={(v) => setHistoryOpenVersion(v)}
                onRevert={(v) => {
                  setEditorContent(v.content);
                  setEditorSubject(v.subjectLine);
                  baselineRef.current = v.content;
                  saveVersion.mutate({
                    content: v.content,
                    subjectLine: v.subjectLine,
                    sourceRequest: `Reverted to v${v.version}`,
                    source: "manual_edit",
                  });
                  setShowHistory(false);
                }}
              />
            )}

            {/* Footer actions */}
            <div
              className="sticky bottom-0 left-0 right-0 mt-6 flex items-center justify-end gap-2 border-t py-3"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface)",
              }}
            >
              <button
                onClick={() =>
                  saveVersion.mutate({
                    content: editorContent,
                    subjectLine: editorSubject,
                    sourceRequest: "Manual save",
                    source: "manual_edit",
                  })
                }
                disabled={saveVersion.isPending}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-medium"
                style={{
                  border: "1px solid var(--border)",
                  color: "var(--text-secondary)",
                  backgroundColor: "transparent",
                }}
              >
                <Save className="h-3.5 w-3.5" />
                Save draft
              </button>
              <button
                onClick={() => sendToGmail.mutate()}
                disabled={sendToGmail.isPending || !data.context.contact.email}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-medium"
                style={{
                  backgroundColor: "var(--accent-color)",
                  color: "var(--text-inverse)",
                }}
              >
                {sendToGmail.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Save to Gmail
              </button>
            </div>
          </div>
        </section>

        {/* Right column — Refinement chat */}
        <aside
          className="hidden md:flex flex-col w-80 shrink-0 overflow-hidden border-l"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface-sunken)",
          }}
        >
          <RefinementChat
            chat={data.chat}
            input={composerInput}
            setInput={setComposerInput}
            onSubmit={(req) => {
              setComposerInput("");
              handleRefine(req);
            }}
            isRefining={isRefining}
            streamingContent={streamingContent}
          />
        </aside>
      </div>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────

function ContextPanel({
  ctx,
}: {
  ctx: WorkspaceResponse["context"];
}) {
  const [showInbound, setShowInbound] = useState(true);
  const color = getAvatarColor(ctx.contact.name);
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div>
        <p
          className="text-[10.5px] uppercase font-semibold tracking-wider mb-2"
          style={{ color: "var(--text-tertiary)" }}
        >
          Recipient
        </p>
        <div className="flex items-start gap-2.5">
          <Avatar className="h-9 w-9">
            <AvatarFallback
              className="text-[11px] font-semibold"
              style={{ backgroundColor: color.bg, color: color.text }}
            >
              {getInitials(ctx.contact.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <Link
              href={`/people?contact=${ctx.contact.id}`}
              className="block text-[13px] font-semibold truncate"
              style={{ color: "var(--text-primary)" }}
            >
              {ctx.contact.name}
            </Link>
            {ctx.contact.role || ctx.contact.company ? (
              <p
                className="text-[11px] truncate"
                style={{ color: "var(--text-tertiary)" }}
              >
                {[ctx.contact.role, ctx.contact.company]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            <p
              className="text-[11px] mt-1"
              style={{ color: "var(--text-tertiary)" }}
            >
              {ctx.relationshipType.replace(/_/g, " ")} ·{" "}
              {ctx.contact.tier.toLowerCase()}
            </p>
          </div>
        </div>
      </div>

      {ctx.replyContext && (
        <div>
          <button
            onClick={() => setShowInbound((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <span
              className="text-[10.5px] uppercase font-semibold tracking-wider"
              style={{ color: "var(--text-tertiary)" }}
            >
              They wrote
            </span>
            {showInbound ? (
              <ChevronUp className="h-3 w-3" style={{ color: "var(--text-tertiary)" }} />
            ) : (
              <ChevronDown className="h-3 w-3" style={{ color: "var(--text-tertiary)" }} />
            )}
          </button>
          {showInbound && (
            <div className="mt-2 space-y-1.5">
              {ctx.replyContext.latestInbound.subject && (
                <p
                  className="text-[12px] font-medium"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {ctx.replyContext.latestInbound.subject}
                </p>
              )}
              <p
                className="text-[11.5px] whitespace-pre-wrap"
                style={{
                  color: "var(--text-tertiary)",
                  lineHeight: 1.5,
                  maxHeight: 200,
                  overflowY: "auto",
                }}
              >
                {ctx.replyContext.latestInbound.body}
              </p>
              {!ctx.replyContext.latestInbound.bodyIsFull && (
                <p
                  className="text-[10.5px] italic"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Snippet only — full body couldn&rsquo;t be fetched.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {ctx.memory && (Array.isArray(ctx.memory.openThreads) && ctx.memory.openThreads.length > 0 ||
        ctx.memory.recurringThemes.length > 0) && (
        <div>
          <p
            className="text-[10.5px] uppercase font-semibold tracking-wider mb-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            What you know
          </p>
          {ctx.memory.recurringThemes.length > 0 && (
            <p
              className="text-[11.5px]"
              style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}
            >
              Themes: {ctx.memory.recurringThemes.join(", ")}
            </p>
          )}
        </div>
      )}

      <div>
        <p
          className="text-[10.5px] uppercase font-semibold tracking-wider mb-2"
          style={{ color: "var(--text-tertiary)" }}
        >
          Voice sources ({ctx.references.length})
        </p>
        {ctx.references.length === 0 ? (
          <Link
            href="/voice/references"
            className="text-[11.5px] underline"
            style={{ color: "var(--text-tertiary)" }}
          >
            Upload reference materials →
          </Link>
        ) : (
          <ul className="space-y-1">
            {ctx.references.map((r) => (
              <li
                key={r.id}
                className="text-[11.5px]"
                style={{ color: "var(--text-secondary)" }}
              >
                · {r.filename}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RefinementChat({
  chat,
  input,
  setInput,
  onSubmit,
  isRefining,
  streamingContent,
}: {
  chat: RefinementChatMessage[];
  input: string;
  setInput: (s: string) => void;
  onSubmit: (req: string) => void;
  isRefining: boolean;
  streamingContent: string | null;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <p
          className="text-[10.5px] uppercase font-semibold tracking-wider"
          style={{ color: "var(--text-tertiary)" }}
        >
          Refine with Claude
        </p>
        <p
          className="text-[11px] mt-0.5"
          style={{ color: "var(--text-tertiary)" }}
        >
          Iterate the draft in the center column.
        </p>
      </div>

      <div className="px-3 pt-3 flex flex-wrap gap-1.5">
        {REFINEMENT_QUICK_ACTIONS.map((qa) => (
          <button
            key={qa.label}
            disabled={isRefining}
            onClick={() => onSubmit(qa.request)}
            className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
            style={{
              backgroundColor: "var(--surface)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            {qa.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {chat.length === 0 && !isRefining && (
          <p
            className="text-[11.5px] py-4 text-center"
            style={{ color: "var(--text-tertiary)" }}
          >
            Ask for tweaks: &ldquo;shorter&rdquo;, &ldquo;add a joke about
            academic conferences&rdquo;, &ldquo;reference the time we met at
            Aspen&rdquo;.
          </p>
        )}
        {chat.map((m, i) => (
          <ChatBubble key={i} message={m} />
        ))}
        {isRefining && (
          <ChatBubble
            message={{
              role: "assistant",
              content: streamingContent
                ? "Refining the draft…"
                : "Working on it…",
              timestamp: new Date().toISOString(),
            }}
            pulse
          />
        )}
      </div>

      <form
        className="border-t p-3"
        style={{ borderColor: "var(--border)" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) onSubmit(input);
        }}
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isRefining}
            placeholder="Tell Claude what to change…"
            className="flex-1 rounded-full border px-3 py-1.5 text-[12.5px]"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface)",
              color: "var(--text-primary)",
            }}
          />
          <button
            type="submit"
            disabled={isRefining || !input.trim()}
            className="rounded-full p-2 text-[12px] font-medium"
            style={{
              backgroundColor: "var(--accent-color)",
              color: "var(--text-inverse)",
              opacity: isRefining || !input.trim() ? 0.5 : 1,
            }}
            aria-label="Send refinement request"
          >
            {isRefining ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function ChatBubble({
  message,
  pulse,
}: {
  message: RefinementChatMessage;
  pulse?: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="rounded-[var(--radius-md)] px-2.5 py-1.5 max-w-[85%] text-[12px]"
        style={{
          backgroundColor: isUser
            ? "var(--accent-color)"
            : "var(--surface)",
          color: isUser ? "var(--text-inverse)" : "var(--text-secondary)",
          border: isUser ? "none" : "1px solid var(--border)",
          opacity: pulse ? 0.7 : 1,
        }}
      >
        {message.content}
        {message.versionId && (
          <span
            className="block text-[10px] mt-0.5"
            style={{ opacity: 0.7 }}
          >
            → v{message.versionId}
          </span>
        )}
      </div>
    </div>
  );
}

function VariantsPanel({
  variants,
  onPick,
  onClose,
}: {
  variants: DraftVariant[];
  onPick: (v: DraftVariant) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="rounded-[var(--radius-md)] border p-4"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <p
          className="text-[12px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-tertiary)" }}
        >
          Variants — pick one to continue
        </p>
        <button
          onClick={onClose}
          className="text-[11px]"
          style={{ color: "var(--text-tertiary)" }}
        >
          Close
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {variants.map((v) => (
          <div
            key={v.label}
            className="rounded-[var(--radius-md)] border p-3 flex flex-col"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-sunken)",
            }}
          >
            <p
              className="text-[12px] font-medium mb-2"
              style={{ color: "var(--text-primary)" }}
            >
              {v.title}
            </p>
            <p
              className="text-[11.5px] flex-1 whitespace-pre-wrap"
              style={{
                color: "var(--text-secondary)",
                lineHeight: 1.5,
                maxHeight: 220,
                overflowY: "auto",
              }}
            >
              {v.content}
            </p>
            <button
              onClick={() => onPick(v)}
              className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium"
              style={{
                backgroundColor: "var(--accent-color)",
                color: "var(--text-inverse)",
              }}
            >
              Use this one
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function VersionHistoryPanel({
  versions,
  openVersion,
  onOpen,
  onRevert,
}: {
  versions: WorkspaceVersion[];
  openVersion: number | null;
  onOpen: (v: number | null) => void;
  onRevert: (v: WorkspaceVersion) => void;
}) {
  const reversed = useMemo(() => [...versions].reverse(), [versions]);
  return (
    <div
      className="rounded-[var(--radius-md)] border"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-wider px-3 py-2 border-b"
        style={{
          color: "var(--text-tertiary)",
          borderColor: "var(--border)",
        }}
      >
        Version history
      </p>
      <ul>
        {reversed.map((v) => {
          const isLatest = v.version === versions.length;
          const isOpen = openVersion === v.version;
          return (
            <li
              key={v.version}
              className="border-b last:border-b-0"
              style={{ borderColor: "var(--border-subtle, var(--border))" }}
            >
              <button
                onClick={() => onOpen(isOpen ? null : v.version)}
                className="flex w-full items-center justify-between px-3 py-2 text-left"
              >
                <div>
                  <span
                    className="text-[12px] font-medium"
                    style={{ color: "var(--text-primary)" }}
                  >
                    v{v.version}
                    {isLatest && (
                      <span
                        className="ml-1.5 text-[10px] font-normal"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        (current)
                      </span>
                    )}
                  </span>
                  <p
                    className="text-[11px] mt-0.5"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {v.sourceRequest}
                  </p>
                </div>
                <ChevronDown
                  className="h-3 w-3"
                  style={{
                    color: "var(--text-tertiary)",
                    transform: isOpen ? "rotate(180deg)" : "none",
                    transition: "transform var(--duration-fast)",
                  }}
                />
              </button>
              {isOpen && (
                <div className="px-3 pb-3 space-y-2">
                  <p
                    className="text-[12px] whitespace-pre-wrap"
                    style={{
                      color: "var(--text-secondary)",
                      lineHeight: 1.5,
                      maxHeight: 260,
                      overflowY: "auto",
                    }}
                  >
                    {v.content}
                  </p>
                  {!isLatest && (
                    <button
                      onClick={() => onRevert(v)}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
                      style={{
                        backgroundColor: "var(--accent-soft)",
                        color: "var(--accent-color)",
                      }}
                    >
                      Restore as current
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Parse the partial `"content":"…"` chunk from a streaming JSON
 * payload. Handles JSON escapes (\n, \", \\) safely so the editor
 * shows newlines as expected as text streams in.
 */
function parsePartialContent(after: string): string {
  let out = "";
  for (let i = 0; i < after.length; i++) {
    const ch = after[i];
    if (ch === "\\") {
      const next = after[i + 1];
      if (next === "n") {
        out += "\n";
        i++;
      } else if (next === '"') {
        out += '"';
        i++;
      } else if (next === "\\") {
        out += "\\";
        i++;
      } else if (next === "t") {
        out += "\t";
        i++;
      } else {
        out += next ?? "";
        i++;
      }
      continue;
    }
    if (ch === '"') {
      // Closing quote of the content field — stop.
      break;
    }
    out += ch;
  }
  return out;
}
