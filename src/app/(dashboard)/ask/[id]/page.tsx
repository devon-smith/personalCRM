"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Star,
  RotateCw,
  Trash2,
  Loader2,
  AlertCircle,
  CornerDownRight,
} from "lucide-react";
import { toast } from "sonner";
import { Surface, SectionLabel } from "@/components/ds";
import { NetworkQueryBox } from "@/components/network-query/network-query-box";
import {
  removeSavedQueryDetailCache,
  removeSavedQueryFromListCaches,
  restoreSavedQueryCaches,
  setSavedQueryStar,
  snapshotSavedQueryCaches,
} from "@/lib/saved-query-cache";

/**
 * /ask/[id] — deep-link to one historical query + its answer (M0.x.7).
 *
 * Shareable single-user URL. Star, delete, and "Re-run" actions
 * work the same as the row in /ask history. Re-run navigates back
 * to /ask with the query text seeded into the input.
 *
 * M0.x.9: when the query has follow-ups (or Jennifer asks one
 * via the embedded NetworkQueryBox at the bottom), they render
 * chronologically under the parent as a conversation thread.
 */

interface SavedQueryRow {
  id: string;
  query: string;
  title: string | null;
  answer: string | null;
  evidence: unknown;
  isStarred: boolean;
  runCount: number;
  createdAt: string;
  lastRunAt: string | null;
  parentQueryId?: string | null;
  followUpCount?: number;
}

interface FollowUpRow {
  id: string;
  query: string;
  title: string | null;
  answer: string | null;
  evidence: unknown;
  isStarred: boolean;
  createdAt: string;
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

export default function AskByIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [showTrace, setShowTrace] = useState(false);
  // Date.now() during render is impure per react-hooks/refs. Capture
  // once on mount — staleness for "days ago" is fine on a personal
  // single-session surface.
  const [renderNow] = useState(() => Date.now());

  const { data, isLoading, error } = useQuery<{
    savedQuery: SavedQueryRow;
    followUps: FollowUpRow[];
  }>({
    queryKey: ["saved-query", id],
    queryFn: async () => {
      const res = await fetch(`/api/saved-queries/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("Failed to load query");
      return res.json();
    },
  });

  const starMutation = useMutation({
    mutationFn: async (nextStarred: boolean) => {
      const res = await fetch(`/api/saved-queries/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isStarred: nextStarred }),
      });
      if (!res.ok) throw new Error("Star failed");
      const body = (await res.json().catch(() => ({}))) as { updated?: number };
      if (body.updated !== undefined && body.updated < 1) {
        throw new Error("Star failed");
      }
    },
    onMutate: async (nextStarred) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ["saved-query", id] }),
        qc.cancelQueries({ queryKey: ["saved-queries-history"] }),
      ]);
      const snapshot = snapshotSavedQueryCaches(qc, id);
      setSavedQueryStar(qc, id, nextStarred);
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      restoreSavedQueryCaches(qc, id, context?.snapshot);
      toast.error("Couldn't update star");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/saved-queries/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
    },
    onMutate: async () => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ["saved-queries-history"] }),
        qc.cancelQueries({ queryKey: ["saved-queries"] }),
      ]);
      const snapshot = snapshotSavedQueryCaches(qc, id);
      removeSavedQueryFromListCaches(qc, id);
      return { snapshot };
    },
    onSuccess: () => {
      removeSavedQueryDetailCache(qc, id);
      toast.success("Removed from history");
      router.push("/ask");
    },
    onError: (_err, _vars, context) => {
      restoreSavedQueryCaches(qc, id, context?.snapshot);
      toast.error("Couldn't remove");
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--text-tertiary)" }} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>
          Couldn&rsquo;t load this query.
        </p>
        <Link
          href="/ask"
          className="inline-flex items-center gap-1 mt-3 text-[12px]"
          style={{ color: "var(--accent-color)" }}
        >
          <ArrowLeft className="h-3 w-3" />
          Back to history
        </Link>
      </div>
    );
  }

  const row = data.savedQuery;
  const evidence = (row.evidence ?? null) as Evidence | null;
  const created = new Date(row.createdAt);
  const ageDays = Math.floor((renderNow - created.getTime()) / 86_400_000);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div>
        <Link
          href="/ask"
          className="inline-flex items-center gap-1 text-[12px]"
          style={{ color: "var(--text-tertiary)" }}
        >
          <ArrowLeft className="h-3 w-3" />
          Back to history
        </Link>
      </div>

      <header className="space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <h1
            className="ds-display-md"
            style={{ color: "var(--text-primary)" }}
          >
            {row.title ?? row.query}
          </h1>
          <button
            onClick={() => starMutation.mutate(!row.isStarred)}
            className="shrink-0 p-1.5 -m-1.5"
            aria-pressed={row.isStarred}
            aria-label={row.isStarred ? "Unstar" : "Star"}
          >
            <Star
              className="h-5 w-5"
              fill={row.isStarred ? "#B58B3C" : "none"}
              style={{
                color: row.isStarred ? "#B58B3C" : "var(--text-tertiary)",
              }}
              strokeWidth={row.isStarred ? 1.4 : 1.6}
            />
          </button>
        </div>
        {row.title && row.title !== row.query && (
          <p
            className="text-[13px]"
            style={{ color: "var(--text-secondary)" }}
          >
            Asked: <em>{row.query}</em>
          </p>
        )}
        <p
          className="text-[11.5px] tabular-nums"
          style={{ color: "var(--text-tertiary)" }}
        >
          {created.toLocaleString()} · {ageDays} {ageDays === 1 ? "day" : "days"} ago
          {row.runCount > 1 && ` · run ${row.runCount}×`}
        </p>
      </header>

      {row.answer ? (
        <Surface tone="sand" padded>
          <SectionLabel>Answer (as of {created.toLocaleDateString()})</SectionLabel>
          <p
            className="mt-2 text-[14px] whitespace-pre-wrap"
            style={{ color: "var(--text-primary)", lineHeight: 1.6 }}
          >
            {row.answer}
          </p>
        </Surface>
      ) : (
        <Surface tone="mist" padded>
          <p
            className="inline-flex items-center gap-1.5 text-[13px]"
            style={{ color: "var(--text-secondary)" }}
          >
            <AlertCircle className="h-3.5 w-3.5" />
            This query is from before answers were auto-saved. Re-run it to
            see a fresh answer.
          </p>
        </Surface>
      )}

      {evidence?.suggestedContacts && evidence.suggestedContacts.length > 0 && (
        <Surface tone="mist" padded>
          <SectionLabel>Suggested contacts at the time</SectionLabel>
          <ul className="mt-2 space-y-1.5">
            {evidence.suggestedContacts.map((c) => (
              <li
                key={c.contactId}
                className="text-[13px]"
                style={{ color: "var(--text-secondary)" }}
              >
                <Link
                  href={`/people?contact=${c.contactId}`}
                  className="font-medium underline"
                  style={{ color: "var(--text-primary)" }}
                >
                  {c.name}
                </Link>
                {c.reason && (
                  <span style={{ color: "var(--text-tertiary)" }}>
                    {" "}
                    — {c.reason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Surface>
      )}

      {evidence?.reasoningTrace && evidence.reasoningTrace.length > 0 && (
        <Surface tone="mist" padded>
          <button
            onClick={() => setShowTrace((v) => !v)}
            className="w-full flex items-center justify-between"
          >
            <SectionLabel>
              How the answer was built ({evidence.reasoningTrace.length} steps)
            </SectionLabel>
            <span
              className="text-[11.5px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              {showTrace ? "Hide ↑" : "Show ↓"}
            </span>
          </button>
          {showTrace && (
            <ol className="mt-2 space-y-1.5">
              {evidence.reasoningTrace.map((s, i) => (
                <li
                  key={i}
                  className="text-[12px]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span
                    className="font-medium"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {i + 1}. {s.tool}:
                  </span>{" "}
                  {s.summary}
                </li>
              ))}
            </ol>
          )}
        </Surface>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Link
          href={`/ask?seed=${encodeURIComponent(row.query)}`}
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-medium"
          style={{
            backgroundColor: "var(--accent-color)",
            color: "var(--text-inverse)",
          }}
        >
          <RotateCw className="h-3.5 w-3.5" />
          Re-run this question
        </Link>
        <button
          onClick={() => {
            if (confirm("Remove this question from history?")) {
              deleteMutation.mutate();
            }
          }}
          className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-[12px] font-medium ml-auto"
          style={{ color: "var(--text-tertiary)" }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>

      {/* M0.x.9 — follow-up thread + ask-a-follow-up input.
          Threads render chronologically under the parent answer.
          Submitting via the embedded NetworkQueryBox sets
          parentQueryId so the new row links back to this query
          rather than landing as a new top-level entry. */}
      <FollowUpThread
        parentId={row.id}
        followUps={data.followUps ?? []}
      />
    </div>
  );
}

function FollowUpThread({
  parentId,
  followUps,
}: {
  parentId: string;
  followUps: FollowUpRow[];
}) {
  return (
    <div className="pt-4 space-y-4 border-t" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2">
        <CornerDownRight
          className="h-3.5 w-3.5"
          style={{ color: "var(--text-tertiary)" }}
        />
        <SectionLabel>
          Follow-ups ({followUps.length})
        </SectionLabel>
      </div>

      {followUps.length === 0 && (
        <p
          className="text-[12.5px]"
          style={{ color: "var(--text-tertiary)" }}
        >
          Ask a follow-up below to dig deeper — it&rsquo;ll thread under
          this answer rather than starting a new history entry.
        </p>
      )}

      {followUps.map((fu, idx) => (
        <FollowUpItem key={fu.id} item={fu} index={idx + 1} />
      ))}

      {/* Compact embedded query box, parented to this query. */}
      <div className="pt-2">
        <NetworkQueryBox
          parentQueryId={parentId}
          placeholder="Ask a follow-up about this answer…"
          compact
        />
      </div>
    </div>
  );
}

function FollowUpItem({ item, index }: { item: FollowUpRow; index: number }) {
  const [expanded, setExpanded] = useState(true);
  const evidence = (item.evidence ?? null) as Evidence | null;
  return (
    <div
      className="rounded-[var(--radius-md)] border pl-4 pr-3 py-3"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
        borderLeftWidth: 3,
        borderLeftColor: "var(--accent-color)",
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="min-w-0 flex-1">
          <p
            className="text-[10.5px] uppercase font-semibold tracking-wider"
            style={{ color: "var(--text-tertiary)" }}
          >
            Follow-up #{index}
          </p>
          <p
            className="text-[13px] font-medium mt-0.5 truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {item.title ?? item.query}
          </p>
        </div>
        <span
          className="text-[11.5px] tabular-nums shrink-0 ml-2"
          style={{ color: "var(--text-tertiary)" }}
        >
          {new Date(item.createdAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          {item.title && item.title !== item.query && (
            <p
              className="text-[12px]"
              style={{ color: "var(--text-secondary)" }}
            >
              Asked: <em>{item.query}</em>
            </p>
          )}
          {item.answer ? (
            <p
              className="text-[13px] whitespace-pre-wrap"
              style={{ color: "var(--text-primary)", lineHeight: 1.55 }}
            >
              {item.answer}
            </p>
          ) : (
            <p
              className="inline-flex items-center gap-1 text-[12px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              <AlertCircle className="h-3 w-3" />
              No answer cached for this follow-up.
            </p>
          )}
          {evidence?.suggestedContacts &&
            evidence.suggestedContacts.length > 0 && (
              <ul className="space-y-0.5 mt-1">
                {evidence.suggestedContacts.slice(0, 3).map((c) => (
                  <li
                    key={c.contactId}
                    className="text-[11.5px]"
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
            )}
        </div>
      )}
    </div>
  );
}
