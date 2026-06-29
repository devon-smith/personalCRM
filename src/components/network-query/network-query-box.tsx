"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Sparkles,
  Search,
  ChevronDown,
  ChevronUp,
  Loader2,
  Star,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, getAvatarColor } from "@/lib/avatar";
import {
  addSavedQueryToListCaches,
  appendSavedQueryFollowUpCache,
  seedSavedQueryDetailCache,
  setSavedQueryStar,
} from "@/lib/saved-query-cache";

/**
 * Natural-language network query box (M7.3 flagship UI, M7.3b streaming).
 *
 * Lives at the top of the dashboard. Rotating placeholder cycles
 * through example queries when the input is empty + unfocused.
 *
 * Streaming flow (M7.3b):
 *   1. User submits → POST /api/network-query?stream=1
 *   2. SSE arrives: tool_called → tool_result → ... → complete
 *   3. UI renders live progress (each tool call appears as a
 *      pulsing trace line, becomes solid when the result lands)
 *   4. On `complete`, swap the live trace for the final structured
 *      result panel (title + answer + suggestions + collapsible
 *      reasoning trace).
 *
 * If streaming fails partway, we fall back to the partial trace +
 * error message — no silent failures.
 */

const EXAMPLE_QUERIES = [
  "Who should I invite to dinner with Marcus and Sarah?",
  "Which former students work in behavioral economics?",
  "Who in my network might speak at the May conference?",
  "Who haven't I talked to in 6 months that I should reach out to?",
  "Who else knows Marc Beban?",
];

interface QueryResult {
  title: string | null;
  answer: string;
  suggestedContacts: Array<{
    contactId: string;
    name: string;
    reason: string;
  }>;
  reasoningTrace: Array<{
    tool: string;
    input: unknown;
    summary: string;
  }>;
  usage: { inputTokens: number; outputTokens: number };
  /** M0.x.7 — id of the auto-saved SavedQuery row. Set when the
   *  server persists the answer; lets the UI star/deep-link. */
  savedQueryId?: string;
  /** Set when the server reused a rapid exact-match recent answer. */
  cached?: boolean;
}

interface LiveStep {
  tool: string;
  summary: string | null; // null while still executing, set on tool_result
  ok: boolean | null;
}

const TOOL_LABELS: Record<string, string> = {
  search_contacts: "Searching contacts",
  find_contacts_by_topic: "Searching by topic",
  get_contact_profile: "Reading profile",
  get_network_neighbors: "Walking the graph",
  get_interaction_history: "Reading interactions",
  get_memory_summary: "Reading memory",
  find_open_threads: "Finding open threads",
  find_personal_mentions: "Searching personal mentions",
  find_themes: "Pulling themes",
};

export function NetworkQueryBox({
  seedQuery,
  seedQueryKey,
  onSeedConsumed,
  draftQuery,
  draftQueryKey,
  onDraftConsumed,
  parentQueryId,
  placeholder,
  onCompleteFollowUp,
  compact,
  submitTarget = "inline",
  showHistoryLink = false,
}: {
  /** When set (and non-empty), fill the input with this text and
   *  immediately submit. Used by /ask history's Re-run button. */
  seedQuery?: string | null;
  /** Monotonic key that lets identical seed text trigger another
   *  auto-submit without remounting the query box. */
  seedQueryKey?: number | null;
  /** Called once the seedQuery has been consumed so the parent can
   *  clear its state — otherwise re-runs would loop. */
  onSeedConsumed?: () => void;
  /** When set, fill the input with this text but do not submit.
   *  Used by /ask shortcut chips. */
  draftQuery?: string | null;
  /** Monotonic key that lets identical shortcut text refill the
   *  input on repeated clicks. */
  draftQueryKey?: number | null;
  /** Called once the draftQuery has been placed in the input. */
  onDraftConsumed?: () => void;
  /** M0.x.9 — when set, every submit from this instance is sent as
   *  a follow-up to the given SavedQuery. /ask/[id] uses this to
   *  thread refinements under a parent. */
  parentQueryId?: string | null;
  /** Override the rotating placeholder — used when the box is
   *  embedded under a thread ("Ask a follow-up about this answer…"). */
  placeholder?: string;
  /** Called after a follow-up successfully persists so the parent
   *  page can refresh its thread list without polling. */
  onCompleteFollowUp?: (newSavedQueryId: string) => void;
  /** M0.x.11 — when true, suppress the inline result panel after a
   *  query completes. Used by /ask/[id]'s embedded follow-up box
   *  so the answer renders only once in the thread (parent's
   *  thread refresh shows the new follow-up; the embedded box
   *  doesn't double-render it). */
  compact?: boolean;
  /** Inline streams/results on /ask. Dashboard uses ask-page so Home
   *  acts as a launcher and detailed answers stay on /ask. */
  submitTarget?: "inline" | "ask-page";
  /** Optional lightweight link to /ask history. Current app surfaces
   *  either render the full history panel or link to /ask elsewhere,
   *  so keep this off unless a compact embed needs it. */
  showHistoryLink?: boolean;
} = {}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([]);
  const [streamingText, setStreamingText] = useState("");
  // Hydrate from sessionStorage so a parent re-mount (e.g. dashboard's
  // loading skeleton firing during a sync invalidation) doesn't wipe
  // the answer Jennifer is reading. Persists per tab; clears when the
  // tab closes or the user explicitly dismisses / submits a new query.
  // M0.9 fix: "I did a query on the ai but then the results went away
  // very quickly."
  const [result, setResult] = useState<QueryResult | null>(() =>
    submitTarget === "ask-page" ? null : readPersistedResult(),
  );
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(() =>
    submitTarget === "ask-page" ? null : readPersistedQuery(),
  );
  const [error, setError] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  // M0.x.7: star state for the current answer panel. Fresh queries
  // always start unstarred (the auto-saved row is new). Toggle
  // updates this immediately + PATCHes the row; rollback on error.
  const [isStarred, setIsStarred] = useState(false);
  const qc = useQueryClient();

  // Optional "View saved questions (N)" link. Disabled by default so
  // dashboard and /ask do not spend an extra saved-queries request
  // when their surrounding page already provides navigation/history.
  const { data: savedQueriesData } = useQuery<{
    count: number;
  }>({
    queryKey: ["saved-queries"],
    queryFn: async () => {
      const res = await fetch("/api/saved-queries?scope=count");
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    staleTime: 60_000,
    enabled: showHistoryLink,
  });
  const savedCount = savedQueriesData?.count ?? 0;

  const abortRef = useRef<AbortController | null>(null);
  const streamInFlightRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Rotate placeholder every 4s when input is empty + unfocused.
  useEffect(() => {
    if (focused || query.length > 0) return;
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % EXAMPLE_QUERIES.length);
    }, 4000);
    return () => clearInterval(id);
  }, [focused, query]);

  // Cancel in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Persist result + submittedQuery to sessionStorage on every change.
  // Hydration runs in useState initializers above; this effect keeps
  // storage in sync going forward.
  useEffect(() => {
    if (submitTarget === "ask-page") return;
    persistResult(result, submittedQuery);
  }, [result, submittedQuery, submitTarget]);

  // Explicit dismiss handler — the "navigates away / new query" cases
  // are handled by unmount + the submit reset.
  const dismissResult = useCallback(() => {
    setResult(null);
    setSubmittedQuery(null);
    setStreamingText("");
    setLiveSteps([]);
    setShowTrace(false);
  }, []);

  const submit = useCallback(async (
    q: string,
    opts: {
      /** Override the box-level parentQueryId for this one submit. */
      parentOverride?: string | null;
      /** Don't mutate the visible input — useful for Refine, which
       *  shouldn't pollute the ask bar with the raw refinement text. */
      suppressVisible?: boolean;
    } = {},
  ) => {
    const trimmed = q.trim();
    const effectiveParent =
      opts.parentOverride !== undefined
        ? opts.parentOverride
        : parentQueryId ?? null;
    const streamKey = `${effectiveParent ?? "root"}:${trimmed}`;

    if (!trimmed || isStreaming || streamInFlightRef.current) return;
    streamInFlightRef.current = streamKey;

    setResult(null);
    setError(null);
    setLiveSteps([]);
    setStreamingText("");
    setShowTrace(false);
    setIsStarred(false);
    if (!opts.suppressVisible) setQuery(trimmed);
    setSubmittedQuery(trimmed);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/network-query?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          parentQueryId: effectiveParent ?? undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `Query failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by blank lines. Parse complete
        // frames out of the buffer and keep any trailing partial.
        let sepIdx: number;
        while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          handleSseFrame(frame);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(cleanAskError(err instanceof Error ? err.message : "Stream failed"));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      if (streamInFlightRef.current === streamKey) {
        streamInFlightRef.current = null;
      }
    }

    function handleSseFrame(frame: string) {
      const lines = frame.split("\n");
      let event = "message";
      let dataStr = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataStr += line.slice(6);
      }
      if (!dataStr) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(dataStr);
      } catch {
        return;
      }

      switch (event) {
        case "tool_called":
          setLiveSteps((prev) => [
            ...prev,
            {
              tool: String(data.tool ?? "unknown"),
              summary: null,
              ok: null,
            },
          ]);
          break;
        case "tool_result":
          setLiveSteps((prev) => {
            // Find the most recent pending step for this tool (null
            // summary) and resolve it. There can be multiple calls
            // to the same tool — match the OLDEST pending one.
            const idx = prev.findIndex(
              (s) => s.tool === data.tool && s.summary === null,
            );
            if (idx < 0) return prev;
            const next = [...prev];
            next[idx] = {
              tool: next[idx].tool,
              summary: String(data.summary ?? ""),
              ok: Boolean(data.ok),
            };
            return next;
          });
          break;
        case "text_delta":
          setStreamingText((prev) => prev + String(data.text ?? ""));
          break;
        case "complete": {
          const completed = data.result as QueryResult;
          setResult(completed);
          const savedQueryId = completed.savedQueryId;
          if (savedQueryId && !completed.cached) {
            const createdAt = new Date().toISOString();
            const savedQuery = {
              id: savedQueryId,
              query: trimmed,
              title: completed.title,
              answer: completed.answer,
              evidence: {
                suggestedContacts: completed.suggestedContacts,
                reasoningTrace: completed.reasoningTrace,
                tokensIn: completed.usage.inputTokens,
                tokensOut: completed.usage.outputTokens,
              },
              createdAt,
              lastRunAt: createdAt,
              parentQueryId: effectiveParent,
            };
            seedSavedQueryDetailCache(qc, savedQuery);
            if (effectiveParent) {
              appendSavedQueryFollowUpCache(qc, effectiveParent, savedQuery);
            } else {
              addSavedQueryToListCaches(qc, savedQuery);
            }
          }
          if (effectiveParent && savedQueryId && onCompleteFollowUp) {
            onCompleteFollowUp(savedQueryId);
          }
          break;
        }
        case "error":
          setError(cleanAskError(String(data.message ?? "Unknown error")));
          break;
      }
    }
  }, [isStreaming, qc, parentQueryId, onCompleteFollowUp]);

  // M0.x.7: parent passes a seedQuery (from /ask history "Re-run").
  // Fill the input + auto-submit, then notify so the parent clears.
  // This is a setState-in-effect on purpose — submit() is the only
  // entry point that wires the streaming pipeline, and we need to
  // trigger it from a prop change rather than a click handler.
  useEffect(() => {
    if (!seedQuery) return;
    if (isStreaming) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    submit(seedQuery);
    if (onSeedConsumed) onSeedConsumed();
  }, [seedQuery, seedQueryKey, isStreaming, submit, onSeedConsumed]);

  // /ask shortcut chips should stage the prompt for editing without
  // spending API calls or replacing the current answer panel.
  useEffect(() => {
    if (!draftQuery) return;
    if (isStreaming) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(draftQuery);
    setError(null);
    inputRef.current?.focus();
    if (onDraftConsumed) onDraftConsumed();
  }, [draftQuery, draftQueryKey, isStreaming, onDraftConsumed]);

  return (
    <section className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = query.trim();
          if (submitTarget === "ask-page") {
            if (!trimmed) return;
            router.push(`/ask?seed=${encodeURIComponent(trimmed)}`);
            return;
          }
          submit(query);
        }}
        className="relative"
      >
        <div
          className="flex items-center gap-3 rounded-[16px] bg-white py-3 pl-5 pr-3 transition-all sm:py-4"
          style={{
            border: `1px solid ${focused ? "#C8B89A" : "#E4DACB"}`,
            boxShadow: focused
              ? "0 12px 32px rgba(40, 30, 20, 0.12)"
              : "0 10px 28px rgba(40, 30, 20, 0.08)",
          }}
        >
          <Sparkles
            className="h-5 w-5 shrink-0"
            style={{ color: "#B8613D" }}
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={isStreaming}
            placeholder={placeholder ?? EXAMPLE_QUERIES[placeholderIdx]}
            className="min-w-0 flex-1 border-0 bg-transparent py-1 text-[17px] outline-none placeholder:text-[#6B6258] sm:text-[19px]"
            style={{ color: "#1B1A17" }}
          />
          <button
            type="submit"
            disabled={!query.trim() || isStreaming}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-4 py-2.5 text-[14px] font-semibold disabled:opacity-40 transition-opacity"
            style={{
              backgroundColor: "#1B1A17",
              color: "white",
            }}
          >
            {isStreaming ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            Ask
          </button>
        </div>
      </form>

      {/* Optional history link for compact embeds that do not already
          show /ask navigation or the full history panel. */}
      {showHistoryLink && savedCount > 0 && (
        <div className="flex justify-end -mt-1">
          <Link
            href="/ask"
            className="text-[11px] transition-colors"
            style={{ color: "#8C8A82" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#5A574F";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#8C8A82";
            }}
          >
            View question history ({savedCount}) →
          </Link>
        </div>
      )}

      {/* Live trace while streaming — collapses into the final
          result panel once `complete` arrives. In compact mode (an
          embedded follow-up box on /ask/[id]) we suppress everything
          past the input bar so the answer renders only once in the
          parent thread. */}
      {!compact && isStreaming && liveSteps.length > 0 && !result && (
        <LiveTracePanel steps={liveSteps} streamingText={streamingText} />
      )}

      {error && (
        <div
          className="text-[12px] px-3 py-2 rounded-xl"
          style={{ backgroundColor: "#F5E6E2", color: "#7A2D2D" }}
        >
          {error}
        </div>
      )}

      {!compact && result && submittedQuery && (
        <QueryResultPanel
          result={result}
          showTrace={showTrace}
          onToggleTrace={() => setShowTrace((v) => !v)}
          onRefine={(refinement) => {
            // M0.x.11 — refine as a proper multi-turn follow-up:
            // pass the refinement alone as the new query + the
            // current result's savedQueryId as parentQueryId. The
            // server seeds the orchestrator with parent question +
            // answer so Claude sees this as turn 2 of a conversation
            // (not a single-turn "original\n\nAdditional constraint"
            // pattern, which was producing empty answers and looked
            // ugly in the input bar).
            submit(refinement, {
              parentOverride: result.savedQueryId ?? null,
              suppressVisible: true,
            });
          }}
          onToggleStar={async () => {
            // M0.x.7 — every query auto-saves; the toolbar action
            // just flips the star bit. Optimistic flip so the icon
            // updates immediately; rollback on error.
            if (!result.savedQueryId) {
              toast.error("Couldn't star this query (not yet saved)");
              return;
            }
            const nextStarred = !isStarred;
            setIsStarred(nextStarred);
            try {
              const res = await fetch(
                `/api/saved-queries/${encodeURIComponent(result.savedQueryId)}`,
                {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ isStarred: nextStarred }),
                },
              );
              if (!res.ok) throw new Error("Star failed");
              toast.success(nextStarred ? "Starred" : "Unstarred");
              setSavedQueryStar(qc, result.savedQueryId, nextStarred);
            } catch (err) {
              setIsStarred(!nextStarred); // rollback
              setSavedQueryStar(qc, result.savedQueryId, !nextStarred);
              toast.error(
                err instanceof Error ? err.message : "Couldn't star",
              );
            }
          }}
          isStarred={isStarred}
          onDismiss={dismissResult}
        />
      )}
    </section>
  );
}

// ─── Result persistence helpers ────────────────────────────
//
// sessionStorage survives the same-tab life of the component but dies
// on tab close. Parent re-mounts (e.g. dashboard sync invalidation
// briefly triggering the loading skeleton) no longer wipe the answer
// Jennifer is reading. Defensive against ANY re-mount cause, not just
// the ones we can prove from the diagnostic.

const STORAGE_KEY = "network-query-last-result";

interface PersistedSlot {
  result: QueryResult;
  submittedQuery: string;
}

function readPersistedResult(): QueryResult | null {
  const slot = readSlot();
  return slot?.result ?? null;
}

function readPersistedQuery(): string | null {
  const slot = readSlot();
  return slot?.submittedQuery ?? null;
}

function readSlot(): PersistedSlot | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSlot>;
    if (!parsed.result || !parsed.submittedQuery) return null;
    return parsed as PersistedSlot;
  } catch {
    return null;
  }
}

function persistResult(
  result: QueryResult | null,
  submittedQuery: string | null,
): void {
  try {
    if (typeof window === "undefined") return;
    if (result && submittedQuery) {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ result, submittedQuery }),
      );
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // SessionStorage can throw in private browsing / quota-exceeded
    // / disabled-cookies contexts. Persistence is best-effort.
  }
}

// ─── Live trace (visible while streaming) ──────────────────

function LiveTracePanel({
  steps,
  streamingText,
}: {
  steps: LiveStep[];
  streamingText: string;
}) {
  return (
    <article
      className="rounded-2xl p-4 space-y-1.5"
      style={{ backgroundColor: "#F4EFE3", border: "1px solid #ECE7D9" }}
    >
      <div
        className="text-[10px] uppercase tracking-wider mb-2"
        style={{ color: "#8C8A82" }}
      >
        Thinking…
      </div>
      {steps.map((step, i) => (
        <div
          key={i}
          className="flex items-center gap-2 text-[13px]"
          style={{
            color: step.summary ? "#1B1A17" : "#5A574F",
            opacity: step.summary ? 1 : 0.7,
          }}
        >
          {step.summary === null ? (
            <Loader2
              className="h-3 w-3 animate-spin shrink-0"
              style={{ color: "#7A4F3C" }}
            />
          ) : (
            <span
              className="h-3 w-3 rounded-full shrink-0 inline-block"
              style={{
                backgroundColor: step.ok ? "#7A4F3C" : "#A85A45",
              }}
            />
          )}
          <span style={{ color: "#5A574F" }}>
            {TOOL_LABELS[step.tool] ?? step.tool}
          </span>
          {step.summary && (
            <span style={{ color: "#8C8A82" }}>— {step.summary}</span>
          )}
        </div>
      ))}
      {streamingText && (
        <div
          className="mt-3 pt-3 border-t"
          style={{ borderColor: "#ECE7D9" }}
        >
          {looksLikeJsonInProgress(streamingText) ? (
            // The orchestrator's final output is JSON; while Claude is
            // streaming the structure, surfacing it raw shows
            // `{ "title": "...", "answer": "...` which is jarring. Show
            // a calm placeholder until the JSON parses into the final
            // result panel (which replaces this section).
            <div
              className="flex items-center gap-2 text-[13px]"
              style={{ color: "#5A574F" }}
            >
              <span
                className="inline-block w-1 h-3.5 align-text-bottom animate-pulse"
                style={{ backgroundColor: "#7A4F3C" }}
              />
              Writing answer…
            </div>
          ) : (
            <p
              className="text-[14px] leading-relaxed"
              style={{ color: "#1B1A17" }}
            >
              {streamingText}
              <span
                className="inline-block w-1 h-3.5 ml-0.5 align-text-bottom animate-pulse"
                style={{ backgroundColor: "#7A4F3C" }}
              />
            </p>
          )}
        </div>
      )}
    </article>
  );
}

// ─── Final result render (unchanged from M7.3) ─────────────

function QueryResultPanel({
  result,
  showTrace,
  onToggleTrace,
  onRefine,
  onToggleStar,
  isStarred,
  onDismiss,
}: {
  result: QueryResult;
  showTrace: boolean;
  onToggleTrace: () => void;
  onRefine: (refinement: string) => void;
  onToggleStar: () => void;
  isStarred: boolean;
  onDismiss: () => void;
}) {
  const [refinement, setRefinement] = useState("");
  const [refineOpen, setRefineOpen] = useState(false);
  return (
    <article
      className="relative rounded-2xl p-5 space-y-4"
      style={{ backgroundColor: "#FBF8F1", border: "1px solid #ECE7D9" }}
    >
      {/* Explicit dismiss — the answer otherwise persists until a new
          query or tab close. Top-right, subtle. */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss result"
        className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors"
        style={{ color: "#8C8A82" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "#ECE7D9";
          e.currentTarget.style.color = "#1B1A17";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "";
          e.currentTarget.style.color = "#8C8A82";
        }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {result.title && (
        <h2
          className="text-[15px] font-medium uppercase tracking-wider pr-6"
          style={{ color: "#5A574F" }}
        >
          {result.title}
        </h2>
      )}
      {result.answer && (
        <p className="text-[14px] leading-relaxed" style={{ color: "#1B1A17" }}>
          {result.answer}
        </p>
      )}

      {result.suggestedContacts.length > 0 && (
        <ul className="space-y-2">
          {result.suggestedContacts.map((s) => (
            <li key={s.contactId}>
              <Link
                href={`/people?contact=${s.contactId}`}
                className="flex items-start gap-3 p-3 rounded-xl transition-colors"
                style={{
                  backgroundColor: "#F4EFE3",
                  border: "1px solid #ECE7D9",
                }}
              >
                <Avatar className="h-9 w-9 mt-0.5">
                  <AvatarFallback
                    className="text-[11px] font-medium"
                    style={{
                      backgroundColor: getAvatarColor(s.name).bg,
                      color: getAvatarColor(s.name).text,
                    }}
                  >
                    {getInitials(s.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[14px] font-medium"
                    style={{ color: "#1B1A17" }}
                  >
                    {s.name}
                  </div>
                  <div
                    className="text-[12px] leading-snug mt-0.5"
                    style={{ color: "#5A574F" }}
                  >
                    {s.reason}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* M7.4: refine + save row. Subtle by default — Jennifer needs
          to know they're there but they shouldn't dominate the panel. */}
      <div
        className="flex items-center gap-3 pt-1 border-t"
        style={{ borderColor: "#ECE7D9" }}
      >
        <button
          onClick={() => setRefineOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider transition-colors"
          style={{ color: refineOpen ? "#1B1A17" : "#8C8A82" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#1B1A17";
          }}
          onMouseLeave={(e) => {
            if (!refineOpen) e.currentTarget.style.color = "#8C8A82";
          }}
        >
          <Wand2 className="h-3 w-3" />
          Refine
        </button>
        <button
          onClick={onToggleStar}
          className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider transition-colors"
          style={{ color: isStarred ? "#B58B3C" : "#8C8A82" }}
          aria-pressed={isStarred}
          title={
            isStarred
              ? "Remove star — this answer stays in history regardless"
              : "Star this answer to find it faster later"
          }
        >
          <Star
            className="h-3 w-3"
            fill={isStarred ? "#B58B3C" : "none"}
            strokeWidth={isStarred ? 1.4 : 1.6}
          />
          {isStarred ? "Starred" : "Star"}
        </button>
      </div>

      {refineOpen && (
        <form
          className="flex items-center gap-2 -mt-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!refinement.trim()) return;
            onRefine(refinement.trim());
            setRefinement("");
            setRefineOpen(false);
          }}
        >
          <input
            value={refinement}
            onChange={(e) => setRefinement(e.target.value)}
            placeholder="Not Marcus, someone more senior…"
            autoFocus
            className="flex-1 bg-transparent border-0 outline-none text-[13px] py-1.5 placeholder:text-[#8C8A82]"
            style={{
              color: "#1B1A17",
              borderBottom: "1px solid #C8B89A",
            }}
          />
          <button
            type="submit"
            disabled={!refinement.trim()}
            className="text-[11px] uppercase tracking-wider px-2 py-1 rounded-md disabled:opacity-40"
            style={{ backgroundColor: "#7A4F3C", color: "white" }}
          >
            Refine
          </button>
        </form>
      )}

      {result.reasoningTrace.length > 0 && (
        <div className="pt-1">
          <button
            onClick={onToggleTrace}
            className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider"
            style={{ color: "#8C8A82" }}
          >
            {showTrace ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            How I thought about this ({result.reasoningTrace.length}{" "}
            step{result.reasoningTrace.length === 1 ? "" : "s"})
          </button>
          {showTrace && (
            <ol
              className="mt-2 space-y-1 pl-4 list-decimal text-[12px]"
              style={{ color: "#5A574F" }}
            >
              {result.reasoningTrace.map((step, i) => (
                <li key={i}>
                  <span style={{ color: "#1B1A17", fontWeight: 500 }}>
                    {TOOL_LABELS[step.tool] ?? step.tool}
                  </span>
                  : {step.summary}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </article>
  );
}

function cleanAskError(message: string): string {
  const modelMatch = message.match(/"message":"model:\s*([^"]+)"/);
  if (modelMatch) {
    return `The Ask model is unavailable (${modelMatch[1]}). Please refresh and try again.`;
  }

  if (/not_found_error/i.test(message) && /model:/i.test(message)) {
    return "The Ask model is unavailable. Please refresh and try again.";
  }

  if (message.startsWith("404 {")) {
    return "The Ask provider returned a model error. Please refresh and try again.";
  }

  return message;
}

/**
 * The orchestrator emits its final answer as JSON ({ title, answer,
 * suggestions, ... }). During streaming the user would otherwise see
 * raw JSON tokens arrive char-by-char — "{ \"title\": \"..." — which
 * reads like a glitch. Detect the leading-brace case and show a calm
 * placeholder instead. The final parsed result replaces this panel
 * when `complete` arrives.
 */
/**
 * Detect when the streaming text is showing raw structured-output
 * JSON the orchestrator is producing as its final answer. The
 * previous check only matched text that STARTED with `{` — in
 * practice Claude often emits a sentence or two of prose before
 * the JSON envelope, so the raw `{ "title": "...", "answer": ...`
 * leaked into the visible stream.
 *
 * This catches:
 *  - Text starting with `{` or ```json fence
 *  - Text containing any of the known final-answer JSON field
 *    markers in the last 400 chars (handles prose-then-JSON)
 */
function looksLikeJsonInProgress(text: string): boolean {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("```json")) return true;
  // Scan only the tail — if the model wrote prose then started JSON,
  // the markers will be near the end of what we've buffered so far.
  const tail = text.slice(-400);
  return (
    /"answer"\s*:/.test(tail) ||
    /"title"\s*:/.test(tail) ||
    /"suggestedContacts"\s*:/.test(tail) ||
    /"suggestions"\s*:/.test(tail) ||
    /"contactId"\s*:/.test(tail)
  );
}
