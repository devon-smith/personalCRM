"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Check, X, CircleDot, Clock } from "lucide-react";
import { toast } from "sonner";
import type { ActionItemResponse } from "@/app/api/action-items/route";
import type { ExtractResult } from "@/lib/gmail/extract-actions";

function formatDueDate(iso: string): string {
  const due = new Date(iso);
  const now = new Date();
  const diffDays = Math.ceil(
    (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays <= 7) return `In ${diffDays}d`;
  return due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function DueBadge({ iso }: { iso: string }) {
  const due = new Date(iso);
  const now = new Date();
  const overdue = due < now;

  return (
    <span
      className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        backgroundColor: overdue ? "#FAEAE7" : "#F3F4F6",
        color: overdue ? "#BF5040" : "#7B8189",
      }}
    >
      <Clock className="mr-0.5 inline h-2.5 w-2.5" />
      {formatDueDate(iso)}
    </span>
  );
}

export function ActionItems() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ items: ActionItemResponse[] }>({
    queryKey: ["action-items"],
    queryFn: async () => {
      const res = await fetch("/api/action-items");
      if (!res.ok) throw new Error("Failed to fetch action items");
      return res.json();
    },
  });

  const extract = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/action-items", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Extraction failed");
      }
      return res.json() as Promise<ExtractResult>;
    },
    onSuccess: (result) => {
      if (result.actionsSaved > 0) {
        toast(`Found ${result.actionsSaved} action items from ${result.threadsAnalyzed} threads`);
      } else {
        toast("No new action items found");
      }
      queryClient.invalidateQueries({ queryKey: ["action-items"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "DONE" | "DISMISSED";
    }) => {
      const res = await fetch(`/api/action-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["action-items"] });
    },
  });

  const items = data?.items ?? [];
  const hasItems = items.length > 0;

  return (
    <div className="crm-animate-enter">
      <div className="flex items-center justify-between">
        <h3
          className="text-[14px] font-semibold text-[#1A1A1A]"
          style={{ letterSpacing: "-0.02em" }}
        >
          Action items
        </h3>
        <button
          className="flex items-center gap-1.5 text-[12px] font-medium text-[#B5BAC0] transition-colors hover:text-[#6366F1]"
          onClick={() => extract.mutate()}
          disabled={extract.isPending}
        >
          {extract.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {extract.isPending ? "Scanning..." : "Scan emails"}
        </button>
      </div>

      {isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-[13px] text-[#C1C5CA]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading...
        </div>
      ) : !hasItems ? (
        <div className="mt-4 rounded-[12px] bg-[#F7F7F8] px-4 py-6 text-center">
          <CircleDot className="mx-auto h-5 w-5 text-[#C8CDD3]" />
          <p className="mt-2 text-[13px] text-[#9BA1A8]">
            No open action items.
          </p>
          <p className="mt-0.5 text-[12px] text-[#C1C5CA]">
            Click &quot;Scan emails&quot; to check your recent inbox.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-0.5">
          {items.map((item) => (
            <div
              key={item.id}
              className="group flex items-start gap-3 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-[#F7F7F8]"
            >
              {/* Done button */}
              <button
                className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[#D1D5DB] text-transparent transition-colors hover:border-[#4A8C5E] hover:bg-[#EBF5EE] hover:text-[#4A8C5E]"
                onClick={() =>
                  updateStatus.mutate({ id: item.id, status: "DONE" })
                }
              >
                <Check className="h-2.5 w-2.5" />
              </button>

              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-[#2A2D32]">
                  {item.title}
                </p>
                <div className="mt-0.5 flex items-center gap-2">
                  {item.contact && (
                    <span className="text-[11px] text-[#9BA1A8]">
                      {item.contact.name}
                    </span>
                  )}
                  {item.contact && item.dueDate && (
                    <span className="text-[#D1D5DB]">&middot;</span>
                  )}
                  {item.dueDate && <DueBadge iso={item.dueDate} />}
                </div>
                {item.context && (
                  <p className="mt-1 text-[11px] leading-relaxed text-[#B5BAC0]">
                    &ldquo;{item.context}&rdquo;
                  </p>
                )}
              </div>

              {/* Dismiss button */}
              <button
                className="mt-0.5 shrink-0 text-transparent transition-colors group-hover:text-[#C1C5CA] hover:!text-[#BF5040]"
                onClick={() =>
                  updateStatus.mutate({ id: item.id, status: "DISMISSED" })
                }
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
