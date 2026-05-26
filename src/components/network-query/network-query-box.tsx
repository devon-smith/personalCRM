"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Sparkles,
  Search,
  ChevronDown,
  ChevronUp,
  Loader2,
  Bookmark,
  Wand2,
  Check,
  X,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, getAvatarColor } from "@/lib/avatar";

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

export function NetworkQueryBox() {
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
    readPersistedResult(),
  );
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(() =>
    readPersistedQuery(),
  );
  const [error, setError] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  // M7.4: submittedQuery tracks which question produced the current
  // result so refine + save can reference it. Hydrated above alongside
  // result so the pair stays in sync across re-mounts.
  const [savedFlash, setSavedFlash] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
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
    persistResult(result, submittedQuery);
  }, [result, submittedQuery]);

  // Explicit dismiss handler — the "navigates away / new query" cases
  // are handled by unmount + the submit reset.
  const dismissResult = useCallback(() => {
    setResult(null);
    setSubmittedQuery(null);
    setStreamingText("");
    setLiveSteps([]);
    setShowTrace(false);
  }, []);

  const submit = useCallback(async (q: string) => {
    if (!q.trim() || isStreaming) return;

    setResult(null);
    setError(null);
    setLiveSteps([]);
    setStreamingText("");
    setShowTrace(false);
    setSavedFlash(false);
    setSubmittedQuery(q.trim());
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/network-query?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim() }),
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
      setError(err instanceof Error ? err.message : "Stream failed");
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
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
        case "complete":
          setResult(data.result as QueryResult);
          break;
        case "error":
          setError(String(data.message ?? "Unknown error"));
          break;
      }
    }
  }, [isStreaming]);

  return (
    <section className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(query);
        }}
        className="relative"
      >
        <div
          className="flex items-center gap-2.5 rounded-2xl pl-3 pr-1.5 py-1.5 transition-all"
          style={{
            backgroundColor: "#F4EFE3",
            border: `1px solid ${focused ? "#C8B89A" : "#ECE7D9"}`,
            boxShadow: focused
              ? "0 1px 3px rgba(122, 79, 60, 0.08)"
              : "0 1px 0 rgba(0,0,0,0.02)",
          }}
        >
          <Sparkles
            className="h-4 w-4 shrink-0"
            style={{ color: "#7A4F3C" }}
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={isStreaming}
            placeholder={EXAMPLE_QUERIES[placeholderIdx]}
            className="flex-1 bg-transparent border-0 outline-none text-[14px] py-1.5 placeholder:text-[#8C8A82]"
            style={{ color: "#1B1A17" }}
          />
          <button
            type="submit"
            disabled={!query.trim() || isStreaming}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[12px] font-medium disabled:opacity-40 transition-opacity"
            style={{
              backgroundColor: "#7A4F3C",
              color: "white",
            }}
          >
            {isStreaming ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Search className="h-3 w-3" />
            )}
            Ask
          </button>
        </div>
      </form>

      {/* Live trace while streaming — collapses into the final
          result panel once `complete` arrives. */}
      {isStreaming && liveSteps.length > 0 && !result && (
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

      {result && submittedQuery && (
        <QueryResultPanel
          result={result}
          showTrace={showTrace}
          onToggleTrace={() => setShowTrace((v) => !v)}
          onRefine={(refinement) =>
            // Refining re-runs the orchestrator with the original
            // question + the new constraint stacked on top. We don't
            // pass the prior answer back — Claude re-derives so the
            // refined result is self-consistent rather than a delta
            // off a possibly-misleading first pass.
            submit(`${submittedQuery}\n\nAdditional constraint: ${refinement}`)
          }
          onSave={async () => {
            try {
              const res = await fetch("/api/saved-queries", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  query: submittedQuery,
                  title: result.title ?? null,
                }),
              });
              if (!res.ok) throw new Error("Save failed");
              setSavedFlash(true);
              toast.success("Saved — find it on /queries");
              setTimeout(() => setSavedFlash(false), 2000);
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : "Save failed",
              );
            }
          }}
          savedFlash={savedFlash}
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
  onSave,
  savedFlash,
  onDismiss,
}: {
  result: QueryResult;
  showTrace: boolean;
  onToggleTrace: () => void;
  onRefine: (refinement: string) => void;
  onSave: () => void;
  savedFlash: boolean;
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
          onClick={onSave}
          disabled={savedFlash}
          className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider transition-colors disabled:opacity-60"
          style={{ color: savedFlash ? "#7A4F3C" : "#8C8A82" }}
        >
          {savedFlash ? (
            <Check className="h-3 w-3" />
          ) : (
            <Bookmark className="h-3 w-3" />
          )}
          {savedFlash ? "Saved" : "Save query"}
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

/**
 * The orchestrator emits its final answer as JSON ({ title, answer,
 * suggestions, ... }). During streaming the user would otherwise see
 * raw JSON tokens arrive char-by-char — "{ \"title\": \"..." — which
 * reads like a glitch. Detect the leading-brace case and show a calm
 * placeholder instead. The final parsed result replaces this panel
 * when `complete` arrives.
 */
function looksLikeJsonInProgress(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("```json");
}
