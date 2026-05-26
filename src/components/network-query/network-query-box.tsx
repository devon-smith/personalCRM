"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, Search, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import Link from "next/link";
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
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);

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

  const submit = useCallback(async (q: string) => {
    if (!q.trim() || isStreaming) return;

    setResult(null);
    setError(null);
    setLiveSteps([]);
    setStreamingText("");
    setShowTrace(false);
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

      {result && (
        <QueryResultPanel
          result={result}
          showTrace={showTrace}
          onToggleTrace={() => setShowTrace((v) => !v)}
        />
      )}
    </section>
  );
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
        <p
          className="text-[14px] leading-relaxed mt-3 pt-3 border-t"
          style={{ color: "#1B1A17", borderColor: "#ECE7D9" }}
        >
          {streamingText}
          <span
            className="inline-block w-1 h-3.5 ml-0.5 align-text-bottom animate-pulse"
            style={{ backgroundColor: "#7A4F3C" }}
          />
        </p>
      )}
    </article>
  );
}

// ─── Final result render (unchanged from M7.3) ─────────────

function QueryResultPanel({
  result,
  showTrace,
  onToggleTrace,
}: {
  result: QueryResult;
  showTrace: boolean;
  onToggleTrace: () => void;
}) {
  return (
    <article
      className="rounded-2xl p-5 space-y-4"
      style={{ backgroundColor: "#FBF8F1", border: "1px solid #ECE7D9" }}
    >
      {result.title && (
        <h2
          className="text-[15px] font-medium uppercase tracking-wider"
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
                href={`/contacts/${s.contactId}`}
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
