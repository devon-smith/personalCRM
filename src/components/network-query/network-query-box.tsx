"use client";

import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, Search, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, getAvatarColor } from "@/lib/avatar";

/**
 * Natural-language network query box (M7.3 flagship UI).
 *
 * Lives at the top of the dashboard. Rotating placeholder rotates
 * every 4s when empty + unfocused. Submits to /api/network-query,
 * renders the structured result below.
 *
 * The result UI is intentionally restrained — title, lead paragraph,
 * suggestion cards, "How I thought about this" disclosure. M7.4 will
 * refine this with the "Refine" inline input + animated reasoning
 * traces.
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

const TOOL_LABELS: Record<string, string> = {
  search_contacts: "Searching contacts",
  find_contacts_by_topic: "Searching by topic",
  get_contact_profile: "Reading profile",
  get_network_neighbors: "Walking the graph",
  get_interaction_history: "Reading interactions",
};

export function NetworkQueryBox() {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Rotate placeholder every 4s when input is empty + unfocused.
  useEffect(() => {
    if (focused || query.length > 0) return;
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % EXAMPLE_QUERIES.length);
    }, 4000);
    return () => clearInterval(id);
  }, [focused, query]);

  const mutation = useMutation({
    mutationFn: async (q: string) => {
      const res = await fetch("/api/network-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Query failed");
      }
      return res.json() as Promise<QueryResult>;
    },
    onSuccess: (data) => setResult(data),
  });

  const submit = (q: string) => {
    if (!q.trim() || mutation.isPending) return;
    setResult(null);
    setShowTrace(false);
    mutation.mutate(q.trim());
  };

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
            disabled={mutation.isPending}
            placeholder={EXAMPLE_QUERIES[placeholderIdx]}
            className="flex-1 bg-transparent border-0 outline-none text-[14px] py-1.5 placeholder:text-[#8C8A82]"
            style={{ color: "#1B1A17" }}
          />
          <button
            type="submit"
            disabled={!query.trim() || mutation.isPending}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[12px] font-medium disabled:opacity-40 transition-opacity"
            style={{
              backgroundColor: "#7A4F3C",
              color: "white",
            }}
          >
            {mutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Search className="h-3 w-3" />
            )}
            Ask
          </button>
        </div>
      </form>

      {mutation.isError && (
        <div
          className="text-[12px] px-3 py-2 rounded-xl"
          style={{ backgroundColor: "#F5E6E2", color: "#7A2D2D" }}
        >
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Something went wrong"}
        </div>
      )}

      {result && <QueryResultPanel result={result} showTrace={showTrace} onToggleTrace={() => setShowTrace((v) => !v)} />}
    </section>
  );
}

// ─── Result render ─────────────────────────────────────────

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
