"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, UserPlus, Loader2, Merge } from "lucide-react";
import { toast } from "sonner";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { ReviewItem } from "@/app/api/sightings/route";

const sourceLabels: Record<string, string> = {
  MANUAL: "Manual",
  CSV_IMPORT: "CSV",
  GOOGLE_CONTACTS: "Google Contacts",
  GMAIL_DISCOVER: "Gmail",
  APPLE_CONTACTS: "Apple Contacts",
  IMESSAGE: "iMessage",
  LINKEDIN: "LinkedIn",
  WHATSAPP: "WhatsApp",
};

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null) return null;
  const pct = Math.round(confidence * 100);
  const color = pct >= 80 ? "#4A8C5E" : pct >= 60 ? "#C4962E" : "#BF5040";
  return (
    <span
      className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: `${color}15`, color }}
    >
      {pct}% match
    </span>
  );
}

export function ReviewQueue() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ items: ReviewItem[]; totalPending: number }>({
    queryKey: ["sightings-review"],
    queryFn: async () => {
      const res = await fetch("/api/sightings");
      if (!res.ok) throw new Error("Failed to fetch review queue");
      return res.json();
    },
  });

  const resolve = useMutation({
    mutationFn: async ({ sightingId, action }: { sightingId: string; action: "merge" | "create" | "dismiss" }) => {
      const res = await fetch("/api/sightings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sightingId, action }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to resolve");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      const labels = { merge: "Merged", create: "Created", dismiss: "Dismissed" };
      toast(labels[variables.action]);
      queryClient.invalidateQueries({ queryKey: ["sightings-review"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <p className="crm-section-label">Review queue</p>
        <div className="flex items-center gap-2 text-[13px] text-[#C1C5CA]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return null; // Don't render anything if queue is empty
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="crm-section-label">Review queue</p>
        <span className="rounded-md bg-[#FBF5E8] px-1.5 py-0.5 text-[11px] font-semibold text-[#C4962E]">
          {data?.totalPending ?? 0}
        </span>
      </div>
      <p className="text-[12px] text-[#B5BAC0]">
        Possible duplicates that need your review. Same person?
      </p>

      <div className="space-y-2">
        {items.map((item) => {
          const sightingColor = getAvatarColor(item.name ?? item.email ?? "?");

          return (
            <div
              key={item.id}
              className="rounded-[14px] border border-[#E8EAED] bg-white px-4 py-3"
            >
              {/* Source + confidence header */}
              <div className="flex items-center gap-2 mb-2">
                <span className="rounded-md bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] font-medium text-[#7B8189]">
                  {sourceLabels[item.source] ?? item.source}
                </span>
                <ConfidenceBadge confidence={item.confidence} />
              </div>

              {/* Two-column comparison */}
              <div className="flex gap-4">
                {/* New sighting */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback
                        className="text-[9px] font-semibold"
                        style={{ backgroundColor: sightingColor.bg, color: sightingColor.text }}
                      >
                        {getInitials(item.name ?? "?")}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-[13px] font-medium text-[#1A1A1A] truncate">
                      {item.name ?? "Unknown"}
                    </span>
                  </div>
                  <div className="space-y-0.5 ml-8 text-[11px] text-[#9BA1A8]">
                    {item.email && <div>{item.email}</div>}
                    {item.phone && <div>{item.phone}</div>}
                    {item.company && <div>{item.company}</div>}
                  </div>
                </div>

                {/* Arrow */}
                {item.candidate && (
                  <div className="flex items-center text-[#C8CDD3]">
                    <Merge className="h-4 w-4 rotate-180" />
                  </div>
                )}

                {/* Candidate contact */}
                {item.candidate && (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Avatar className="h-6 w-6">
                        <AvatarFallback
                          className="text-[9px] font-semibold"
                          style={{
                            backgroundColor: getAvatarColor(item.candidate.name).bg,
                            color: getAvatarColor(item.candidate.name).text,
                          }}
                        >
                          {getInitials(item.candidate.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-[13px] font-medium text-[#1A1A1A] truncate">
                        {item.candidate.name}
                      </span>
                    </div>
                    <div className="space-y-0.5 ml-8 text-[11px] text-[#9BA1A8]">
                      {item.candidate.email && <div>{item.candidate.email}</div>}
                      {item.candidate.phone && <div>{item.candidate.phone}</div>}
                      {item.candidate.company && <div>{item.candidate.company}</div>}
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[#F3F4F6]">
                <button
                  className="flex items-center gap-1 rounded-md bg-[#1A1A1A] px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[#2D2D2D] disabled:opacity-50"
                  onClick={() => resolve.mutate({ sightingId: item.id, action: "merge" })}
                  disabled={resolve.isPending || !item.candidate}
                >
                  <Check className="h-3 w-3" />
                  Same person
                </button>
                <button
                  className="flex items-center gap-1 rounded-md bg-[#F3F4F6] px-2.5 py-1 text-[11px] font-medium text-[#7B8189] transition-colors hover:bg-[#EDEEF0] disabled:opacity-50"
                  onClick={() => resolve.mutate({ sightingId: item.id, action: "create" })}
                  disabled={resolve.isPending}
                >
                  <UserPlus className="h-3 w-3" />
                  New contact
                </button>
                <button
                  className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-[#C1C5CA] transition-colors hover:text-[#BF5040] disabled:opacity-50"
                  onClick={() => resolve.mutate({ sightingId: item.id, action: "dismiss" })}
                  disabled={resolve.isPending}
                >
                  <X className="h-3 w-3" />
                  Skip
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
