"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Trash2, Loader2, ChevronRight } from "lucide-react";
import { toast } from "sonner";

/**
 * /queries — saved natural-language network queries (M7.4).
 *
 * List of queries Jennifer has saved from the dashboard search box.
 * Each row: title (auto-derived from the answer's title, editable
 * later) + the query text + last-run-time + click-to-re-run.
 *
 * Re-running fires the orchestrator inline on this page — same
 * streaming UX as the dashboard box, just rooted on the saved-query
 * row.
 */

interface SavedQueryRow {
  id: string;
  query: string;
  title: string | null;
  createdAt: string;
  lastRunAt: string | null;
}

interface QueryResult {
  title: string | null;
  answer: string;
  suggestedContacts: Array<{ contactId: string; name: string; reason: string }>;
  reasoningTrace: Array<{ tool: string; input: unknown; summary: string }>;
  usage: { inputTokens: number; outputTokens: number };
}

export default function SavedQueriesPage() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, QueryResult>>({});

  const { data, isLoading } = useQuery<{ queries: SavedQueryRow[] }>({
    queryKey: ["saved-queries"],
    queryFn: async () => {
      const res = await fetch("/api/saved-queries");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/saved-queries/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-queries"] });
      toast.success("Removed");
    },
    onError: () => toast.error("Couldn't remove"),
  });

  const run = async (row: SavedQueryRow) => {
    if (runningId) return;
    setRunningId(row.id);
    setActiveId(row.id);
    try {
      const res = await fetch("/api/network-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: row.query }),
      });
      if (!res.ok) throw new Error("Query failed");
      const result = (await res.json()) as QueryResult;
      setResults((prev) => ({ ...prev, [row.id]: result }));
      // Bump lastRunAt so this query sorts to the top next time.
      await fetch(`/api/saved-queries/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bumpLastRunAt: true }),
      });
      qc.invalidateQueries({ queryKey: ["saved-queries"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="crm-stagger space-y-8 pt-14">
      <header>
        <h1 className="ds-display-xl">Saved queries</h1>
        <p
          className="ds-body-lg mt-3 max-w-[640px]"
          style={{ color: "var(--text-secondary)" }}
        >
          Questions worth re-asking. Click any to re-run — the answer
          freshens against your current network.
        </p>
      </header>

      {isLoading ? (
        <div className="text-[13px]" style={{ color: "#8C8A82" }}>
          Loading…
        </div>
      ) : !data || data.queries.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3">
          {data.queries.map((row) => (
            <li
              key={row.id}
              className="rounded-2xl overflow-hidden"
              style={{
                backgroundColor: "#F4EFE3",
                border: "1px solid #ECE7D9",
              }}
            >
              <div className="flex items-center gap-3 p-4">
                <Sparkles className="h-4 w-4 shrink-0" style={{ color: "#7A4F3C" }} />
                <div className="min-w-0 flex-1">
                  {row.title && (
                    <div
                      className="text-[11px] uppercase tracking-wider mb-1"
                      style={{ color: "#7A4F3C" }}
                    >
                      {row.title}
                    </div>
                  )}
                  <div
                    className="text-[14px] truncate"
                    style={{ color: "#1B1A17" }}
                  >
                    {row.query}
                  </div>
                  <div
                    className="text-[11px] mt-1"
                    style={{ color: "#8C8A82" }}
                  >
                    {row.lastRunAt
                      ? `Last run ${formatRelative(row.lastRunAt)}`
                      : `Saved ${formatRelative(row.createdAt)}`}
                  </div>
                </div>
                <button
                  onClick={() => run(row)}
                  disabled={runningId !== null}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[12px] font-medium disabled:opacity-50"
                  style={{ backgroundColor: "#7A4F3C", color: "white" }}
                >
                  {runningId === row.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  Re-run
                </button>
                <button
                  onClick={() => deleteMut.mutate(row.id)}
                  disabled={deleteMut.isPending}
                  className="p-1.5 rounded-md transition-colors"
                  style={{ color: "#8C8A82" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#7A2D2D";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#8C8A82";
                  }}
                  aria-label="Delete saved query"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* Inline result for this row, if it's been re-run. */}
              {activeId === row.id && results[row.id] && (
                <div
                  className="px-4 pb-4 pt-2 space-y-3"
                  style={{ borderTop: "1px solid #ECE7D9" }}
                >
                  {results[row.id].answer && (
                    <p
                      className="text-[13px] leading-relaxed"
                      style={{ color: "#1B1A17" }}
                    >
                      {results[row.id].answer}
                    </p>
                  )}
                  {results[row.id].suggestedContacts.length > 0 && (
                    <ul className="space-y-1.5 text-[13px]">
                      {results[row.id].suggestedContacts.map((s) => (
                        <li
                          key={s.contactId}
                          style={{ color: "#1B1A17" }}
                        >
                          <a
                            href={`/contacts/${s.contactId}`}
                            className="font-medium hover:underline"
                          >
                            {s.name}
                          </a>
                          <span style={{ color: "#5A574F" }}> — {s.reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-2xl p-8 text-center"
      style={{ backgroundColor: "#F1ECDE", border: "1px solid #ECE7D9" }}
    >
      <Sparkles
        className="h-6 w-6 mx-auto mb-3"
        style={{ color: "#7A4F3C" }}
      />
      <p className="text-[14px]" style={{ color: "#1B1A17" }}>
        No saved queries yet.
      </p>
      <p
        className="text-[13px] mt-2 max-w-[440px] mx-auto"
        style={{ color: "#5A574F" }}
      >
        Ask a question from the dashboard search, then click{" "}
        <span className="font-medium">Save query</span> to keep it
        here for later.
      </p>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
