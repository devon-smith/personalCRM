"use client";

/**
 * Query history panel for /ask (M0.x.7).
 *
 * Lists every past query + its persisted answer with collapse/expand,
 * star toggle, delete, re-run, search, time-range filter, and sort.
 * Read-only on its own — the parent /ask page owns the "re-run"
 * action which lifts the query text up into the current-query
 * workspace.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Star,
  Search,
  Trash2,
  RotateCw,
  ChevronDown,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

export interface SavedQueryRow {
  id: string;
  query: string;
  title: string | null;
  answer: string | null;
  evidence: unknown;
  isStarred: boolean;
  runCount: number;
  createdAt: string;
  lastRunAt: string | null;
}

interface Evidence {
  suggestedContacts?: Array<{
    contactId: string;
    name: string;
    reason: string;
  }>;
  reasoningTrace?: Array<{
    tool: string;
    input: unknown;
    summary: string;
  }>;
  tokensIn?: number;
  tokensOut?: number;
}

type TimeRange = "all" | "today" | "week" | "month";
type SortMode = "newest" | "oldest" | "most_revisited";

export function HistoryPanel({
  onReRun,
  highlightedId,
  initialQuery,
}: {
  onReRun: (queryText: string) => void;
  /** Highlights one row in the list (deep-link from /ask/[id]). */
  highlightedId?: string;
  /** Pre-filled search box from query string. */
  initialQuery?: string;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState(initialQuery ?? "");
  const [starredOnly, setStarredOnly] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [sort, setSort] = useState<SortMode>("newest");

  const { data, isLoading } = useQuery<{ queries: SavedQueryRow[] }>({
    queryKey: ["saved-queries-history"],
    queryFn: async () => {
      const res = await fetch("/api/saved-queries?limit=200");
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
  });

  const starMutation = useMutation({
    mutationFn: async (args: { id: string; nextStarred: boolean }) => {
      const res = await fetch(
        `/api/saved-queries/${encodeURIComponent(args.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isStarred: args.nextStarred }),
        },
      );
      if (!res.ok) throw new Error("Star failed");
    },
    onMutate: async ({ id, nextStarred }) => {
      await qc.cancelQueries({ queryKey: ["saved-queries-history"] });
      const prev = qc.getQueryData<{ queries: SavedQueryRow[] }>([
        "saved-queries-history",
      ]);
      if (prev) {
        qc.setQueryData<{ queries: SavedQueryRow[] }>(
          ["saved-queries-history"],
          {
            queries: prev.queries.map((q) =>
              q.id === id ? { ...q, isStarred: nextStarred } : q,
            ),
          },
        );
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) qc.setQueryData(["saved-queries-history"], context.prev);
      toast.error("Couldn't update star");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["saved-queries-history"] });
      qc.invalidateQueries({ queryKey: ["saved-queries"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/saved-queries/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-queries-history"] });
      qc.invalidateQueries({ queryKey: ["saved-queries"] });
      toast.success("Removed");
    },
    onError: () => toast.error("Couldn't remove"),
  });

  // Date.now() in a useMemo body is impure-during-render per the
  // new react-hooks rule. Capture once on mount; the "today/week/
  // month" filter being slightly stale across a long-open tab is
  // acceptable for a personal-use surface (refresh to update).
  const [renderNow] = useState(() => Date.now());

  const filtered = useMemo(() => {
    const rows = data?.queries ?? [];
    const now = renderNow;
    const day = 86_400_000;
    const since = (() => {
      switch (timeRange) {
        case "today":
          return now - day;
        case "week":
          return now - 7 * day;
        case "month":
          return now - 30 * day;
        default:
          return null;
      }
    })();
    const searchLower = search.trim().toLowerCase();

    const out = rows.filter((r) => {
      if (starredOnly && !r.isStarred) return false;
      if (since !== null && new Date(r.createdAt).getTime() < since) return false;
      if (searchLower) {
        const haystack = `${r.query} ${r.answer ?? ""} ${r.title ?? ""}`.toLowerCase();
        if (!haystack.includes(searchLower)) return false;
      }
      return true;
    });

    out.sort((a, b) => {
      if (sort === "most_revisited") return b.runCount - a.runCount;
      const aT = new Date(a.createdAt).getTime();
      const bT = new Date(b.createdAt).getTime();
      return sort === "newest" ? bT - aT : aT - bT;
    });
    return out;
  }, [data, search, starredOnly, timeRange, sort, renderNow]);

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h2
          className="ds-display-sm"
          style={{ color: "var(--text-primary)" }}
        >
          History
        </h2>
        <span
          className="text-[11.5px] tabular-nums"
          style={{ color: "var(--text-tertiary)" }}
        >
          {filtered.length} of {data?.queries.length ?? 0}
        </span>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative flex-1 min-w-[180px]">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3"
            style={{ color: "var(--text-tertiary)" }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search past questions & answers…"
            className="w-full rounded-full border pl-7 pr-3 py-1.5 text-[12.5px]"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface)",
              color: "var(--text-primary)",
            }}
          />
        </div>
        <button
          onClick={() => setStarredOnly((v) => !v)}
          aria-pressed={starredOnly}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-medium"
          style={{
            backgroundColor: starredOnly ? "#FBF4E2" : "transparent",
            color: starredOnly ? "#7A5A1F" : "var(--text-tertiary)",
            border: "1px solid var(--border)",
          }}
        >
          <Star
            className="h-3 w-3"
            fill={starredOnly ? "#B58B3C" : "none"}
          />
          Starred
        </button>
        <SegmentedFilter
          value={timeRange}
          onChange={setTimeRange}
          options={[
            { value: "all", label: "All" },
            { value: "today", label: "Today" },
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
          ]}
        />
        <SegmentedFilter
          value={sort}
          onChange={setSort}
          options={[
            { value: "newest", label: "Newest" },
            { value: "oldest", label: "Oldest" },
            { value: "most_revisited", label: "Most run" },
          ]}
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="py-8 text-center">
          <Loader2
            className="h-4 w-4 animate-spin mx-auto"
            style={{ color: "var(--text-tertiary)" }}
          />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          starredOnly={starredOnly}
          searched={search.trim().length > 0}
        />
      ) : (
        <ul className="space-y-2">
          {filtered.map((row) => (
            <HistoryRow
              key={row.id}
              row={row}
              highlighted={row.id === highlightedId}
              onToggleStar={() =>
                starMutation.mutate({
                  id: row.id,
                  nextStarred: !row.isStarred,
                })
              }
              onDelete={() => {
                if (confirm("Remove this question from history?")) {
                  deleteMutation.mutate(row.id);
                }
              }}
              onReRun={() => onReRun(row.query)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function HistoryRow({
  row,
  highlighted,
  onToggleStar,
  onDelete,
  onReRun,
}: {
  row: SavedQueryRow;
  highlighted: boolean;
  onToggleStar: () => void;
  onDelete: () => void;
  onReRun: () => void;
}) {
  const [expanded, setExpanded] = useState(highlighted);
  const evidence = (row.evidence ?? null) as Evidence | null;
  const ago = formatRelative(row.createdAt);
  const hasAnswer = !!row.answer && row.answer.length > 0;

  return (
    <li
      className="rounded-[var(--radius-md)] border transition-colors"
      style={{
        borderColor: highlighted ? "var(--accent-color)" : "var(--border)",
        backgroundColor: highlighted
          ? "var(--accent-soft)"
          : "var(--surface)",
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left"
      >
        <ChevronDown
          className="h-3 w-3 mt-1 shrink-0"
          style={{
            color: "var(--text-tertiary)",
            transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform var(--duration-fast)",
          }}
        />
        <div className="min-w-0 flex-1">
          <p
            className="text-[13px] font-medium truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {row.title ?? row.query}
          </p>
          {row.title && row.title !== row.query && (
            <p
              className="text-[11.5px] truncate"
              style={{ color: "var(--text-tertiary)" }}
            >
              {row.query}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className="text-[11px] tabular-nums"
            style={{ color: "var(--text-tertiary)" }}
          >
            {ago}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar();
            }}
            className="p-1 -m-1"
            aria-label={row.isStarred ? "Unstar" : "Star"}
          >
            <Star
              className="h-3.5 w-3.5"
              fill={row.isStarred ? "#B58B3C" : "none"}
              style={{
                color: row.isStarred ? "#B58B3C" : "var(--text-tertiary)",
              }}
              strokeWidth={row.isStarred ? 1.4 : 1.6}
            />
          </button>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          {hasAnswer ? (
            <p
              className="text-[12.5px] whitespace-pre-wrap"
              style={{
                color: "var(--text-secondary)",
                lineHeight: 1.55,
              }}
            >
              {row.answer}
            </p>
          ) : (
            <p
              className="inline-flex items-center gap-1.5 text-[12px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              <AlertCircle className="h-3 w-3" />
              No answer cached for this older query — re-run to see one.
            </p>
          )}

          {evidence?.suggestedContacts && evidence.suggestedContacts.length > 0 && (
            <div>
              <p
                className="text-[10.5px] uppercase font-semibold tracking-wider mb-1"
                style={{ color: "var(--text-tertiary)" }}
              >
                Suggested contacts
              </p>
              <ul className="space-y-0.5">
                {evidence.suggestedContacts.slice(0, 5).map((c) => (
                  <li
                    key={c.contactId}
                    className="text-[12px]"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    ·{" "}
                    <Link
                      href={`/people?contact=${c.contactId}`}
                      className="underline"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {c.name}
                    </Link>
                    {c.reason ? (
                      <span style={{ color: "var(--text-tertiary)" }}>
                        {" "}
                        — {c.reason}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {evidence?.reasoningTrace && evidence.reasoningTrace.length > 0 && (
            <p
              className="text-[11px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              Asked using:{" "}
              {Array.from(
                new Set(evidence.reasoningTrace.map((t) => t.tool)),
              ).join(", ")}
            </p>
          )}

          <div className="flex items-center gap-1.5 pt-1">
            <button
              onClick={onReRun}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-medium"
              style={{
                backgroundColor: "var(--accent-color)",
                color: "var(--text-inverse)",
              }}
            >
              <RotateCw className="h-3 w-3" />
              Re-run
            </button>
            <Link
              href={`/ask/${row.id}`}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-medium"
              style={{
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              Permalink
            </Link>
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-medium ml-auto"
              style={{
                color: "var(--text-tertiary)",
              }}
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function SegmentedFilter<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  return (
    <div
      className="inline-flex items-center rounded-full p-0.5"
      style={{
        backgroundColor: "var(--surface-sunken)",
        border: "1px solid var(--border)",
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors"
          style={{
            backgroundColor: value === opt.value ? "var(--surface)" : "transparent",
            color:
              value === opt.value
                ? "var(--text-primary)"
                : "var(--text-tertiary)",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function EmptyState({
  starredOnly,
  searched,
}: {
  starredOnly: boolean;
  searched: boolean;
}) {
  return (
    <div className="py-10 text-center">
      <p
        className="text-[13px]"
        style={{ color: "var(--text-secondary)" }}
      >
        {starredOnly
          ? "No starred questions yet."
          : searched
            ? "No questions match this search."
            : "Ask a question above — it'll show up here with its answer."}
      </p>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}
