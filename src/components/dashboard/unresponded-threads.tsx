"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Mail, Inbox, Send, X } from "lucide-react";
import { useDraftComposer } from "@/lib/draft-composer-context";
import type { UnrespondedThread, ReplyPriority } from "@/lib/thread-intelligence";

const priorityDot: Record<ReplyPriority, string> = {
  high: "var(--status-warning)",
  medium: "var(--text-tertiary)",
  low: "var(--border-strong)",
  skip: "var(--border)",
};

export function UnrespondedThreads({ limit = 20 }: { readonly limit?: number } = {}) {
  const { openComposer } = useDraftComposer();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{
    data: UnrespondedThread[];
    count: number;
  }>({
    queryKey: ["unresponded-threads"],
    queryFn: async () => {
      const res = await fetch(`/api/interactions/unresponded?limit=${limit}`);
      if (!res.ok) return { data: [], count: 0 };
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const dismissMutation = useMutation({
    mutationFn: async (interactionId: string) => {
      const res = await fetch(`/api/interactions/${interactionId}/dismiss`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to dismiss");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unresponded-threads"] });
    },
  });

  if (isLoading) {
    return (
      <div>
        <h3 className="crm-section-label mb-3">Awaiting your reply</h3>
        <div className="h-16 animate-pulse rounded-[10px]" style={{ backgroundColor: "var(--surface-sunken)" }} />
      </div>
    );
  }

  const threads = data?.data ?? [];
  const urgentCount = threads.filter((t) => t.priority === "high").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
          <h3 className="crm-section-label">Awaiting your reply</h3>
          {urgentCount > 0 && (
            <span
              className="rounded-[6px] px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ backgroundColor: "var(--surface-sunken)", color: "var(--text-secondary)" }}
            >
              {urgentCount} urgent
            </span>
          )}
        </div>
        {threads.length > 0 && (
          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            {threads.length} total
          </span>
        )}
      </div>

      {threads.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <div
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--surface-sunken)" }}
          >
            <Inbox className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
          </div>
          <p className="ds-body-sm" style={{ color: "var(--text-tertiary)" }}>All caught up</p>
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
          {threads.map((thread) => (
            <div
              key={thread.interactionId}
              className="group flex items-center gap-2.5 py-2 -mx-2 px-2 rounded-[8px] transition-colors"
              style={{ transitionDuration: "var(--duration-fast)" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
            >
              {/* Priority dot */}
              <div
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: priorityDot[thread.priority] }}
              />

              {/* Content — clickable link */}
              <Link
                href={`/people?contact=${thread.contactId}`}
                className="min-w-0 flex-1"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {thread.contactName}
                  </span>
                  {thread.contactCompany && (
                    <span className="text-[10px] truncate shrink-0" style={{ color: "var(--border-strong)" }}>
                      {thread.contactCompany}
                    </span>
                  )}
                  <span className="shrink-0 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                    {thread.daysWaiting}d
                  </span>
                </div>
                {thread.subject && (
                  <p className="text-[11px] truncate" style={{ color: "var(--text-tertiary)" }}>
                    {thread.subject}
                  </p>
                )}
              </Link>

              {/* Actions */}
              <button
                onClick={() =>
                  openComposer({
                    contactId: thread.contactId,
                    presetContext: "reply_email",
                    threadSubject: thread.subject ?? undefined,
                  })
                }
                className="shrink-0 rounded-[var(--radius-sm)] p-1 transition-colors"
                style={{ color: "var(--text-tertiary)" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent-color)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
                title="Draft reply"
              >
                <Send className="h-3 w-3" />
              </button>

              <button
                onClick={() => dismissMutation.mutate(thread.interactionId)}
                disabled={dismissMutation.isPending}
                className="shrink-0 rounded-[var(--radius-sm)] p-1 transition-colors disabled:opacity-50"
                style={{ color: "var(--text-tertiary)" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--status-warning)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
                title="Dismiss"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
