"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Merge,
  Check,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Users,
  AlertCircle,
  Linkedin,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import type { DuplicateGroup } from "@/app/api/contacts/duplicates/route";
import { formatDistanceToNow } from "@/lib/date-utils";

const sourceLabels: Record<string, string> = {
  MANUAL: "Manual",
  CSV_IMPORT: "CSV",
  GOOGLE_CONTACTS: "Google",
  GMAIL_DISCOVER: "Gmail",
  APPLE_CONTACTS: "Apple",
  IMESSAGE: "iMessage",
  LINKEDIN: "LinkedIn",
  WHATSAPP: "WhatsApp",
};

const tierLabels: Record<string, string> = {
  INNER_CIRCLE: "Inner Circle",
  PROFESSIONAL: "Professional",
  ACQUAINTANCE: "Acquaintance",
};

const matchTypeLabels: Record<string, string> = {
  exact_name: "Same name",
  name_and_email: "Same email",
  name_and_phone: "Same phone",
};

interface DuplicatesResponse {
  groups: DuplicateGroup[];
  totalGroups: number;
  totalDuplicates: number;
}

export default function MergePage() {
  const queryClient = useQueryClient();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedPrimary, setSelectedPrimary] = useState<Record<string, string>>({});
  const [mergedGroups, setMergedGroups] = useState<Set<string>>(new Set());

  // Check for LinkedIn review items
  const { data: linkedInReview } = useQuery<{ totalPending: number }>({
    queryKey: ["linkedin-review-count"],
    queryFn: async () => {
      const res = await fetch("/api/import/linkedin/review");
      if (!res.ok) return { totalPending: 0 };
      const data = await res.json();
      return { totalPending: data.totalPending ?? 0 };
    },
  });

  const { data, isLoading } = useQuery<DuplicatesResponse>({
    queryKey: ["duplicates"],
    queryFn: async () => {
      const res = await fetch("/api/contacts/duplicates");
      if (!res.ok) throw new Error("Failed to fetch duplicates");
      return res.json();
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ primaryId, mergeIds }: { primaryId: string; mergeIds: string[] }) => {
      const res = await fetch("/api/contacts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryId, mergeIds }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Merge failed");
      }
      return res.json();
    },
    onSuccess: (_data, _variables) => {
      toast("Contacts merged successfully");
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["duplicates"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const [mergeAllProgress, setMergeAllProgress] = useState({ current: 0, total: 0 });

  const mergeAllMutation = useMutation({
    mutationFn: async (groups: DuplicateGroup[]) => {
      setMergeAllProgress({ current: 0, total: groups.length });
      const mergedKeys: string[] = [];

      for (const group of groups) {
        const sorted = [...group.contacts].sort(
          (a, b) => b.interactionCount - a.interactionCount,
        );
        const primary = sorted[0];
        const mergeIds = sorted.slice(1).map((c) => c.id);

        const res = await fetch("/api/contacts/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ primaryId: primary.id, mergeIds }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? `Merge failed for ${group.normalizedName}`);
        }
        mergedKeys.push(group.key);
        setMergeAllProgress((prev) => ({ ...prev, current: prev.current + 1 }));
      }
      return mergedKeys;
    },
    onSuccess: (mergedKeys) => {
      toast(`Merged ${mergedKeys.length} duplicate groups`);
      setMergedGroups((prev) => {
        const next = new Set(prev);
        mergedKeys.forEach((k) => next.add(k));
        return next;
      });
      setMergeAllProgress({ current: 0, total: 0 });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["duplicates"] });
    },
    onError: (err) => {
      setMergeAllProgress({ current: 0, total: 0 });
      toast.error(err.message);
    },
  });

  function toggleExpand(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleSelectPrimary(groupKey: string, contactId: string) {
    setSelectedPrimary((prev) => ({ ...prev, [groupKey]: contactId }));
  }

  function handleMergeGroup(group: DuplicateGroup) {
    const primaryId = selectedPrimary[group.key] ?? getBestPrimary(group);
    const mergeIds = group.contacts
      .filter((c) => c.id !== primaryId)
      .map((c) => c.id);

    mergeMutation.mutate(
      { primaryId, mergeIds },
      {
        onSuccess: () => {
          setMergedGroups((prev) => new Set([...prev, group.key]));
        },
      },
    );
  }

  function handleMergeAll() {
    if (!data) return;
    const exactNameGroups = data.groups.filter(
      (g) => g.matchType === "exact_name" && !mergedGroups.has(g.key),
    );
    if (exactNameGroups.length === 0) {
      toast("No exact-name duplicates to merge");
      return;
    }
    mergeAllMutation.mutate(exactNameGroups);
  }

  function getBestPrimary(group: DuplicateGroup): string {
    // Pick the contact with the most interactions, then the one with more data
    const sorted = [...group.contacts].sort((a, b) => {
      if (b.interactionCount !== a.interactionCount) {
        return b.interactionCount - a.interactionCount;
      }
      const aFields = [a.email, a.phone, a.company, a.role].filter(Boolean).length;
      const bFields = [b.email, b.phone, b.company, b.role].filter(Boolean).length;
      return bFields - aFields;
    });
    return sorted[0].id;
  }

  const visibleGroups = (data?.groups ?? []).filter((g) => !mergedGroups.has(g.key));
  const exactNameCount = visibleGroups.filter((g) => g.matchType === "exact_name").length;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Merge Duplicates</h1>
          <p className="mt-1 text-sm text-gray-400">Scanning your contacts...</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Finding duplicates...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Merge Duplicates</h1>
          <p className="mt-1 text-sm text-gray-400">
            {visibleGroups.length === 0
              ? "No duplicates found. Your contacts are clean!"
              : `Found ${visibleGroups.length} groups with ${data?.totalDuplicates ?? 0} duplicate contacts`}
          </p>
        </div>
        {exactNameCount > 0 && (
          <Button
            onClick={handleMergeAll}
            disabled={mergeAllMutation.isPending}
            className="gap-2"
          >
            {mergeAllMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Merging {mergeAllProgress.current}/{mergeAllProgress.total}...
              </>
            ) : (
              <>
                <Merge className="h-4 w-4" />
                Auto-merge {exactNameCount} exact matches
              </>
            )}
          </Button>
        )}
      </div>

      {/* LinkedIn review banner */}
      {linkedInReview && linkedInReview.totalPending > 0 && (
        <Link href="/merge/linkedin">
          <div className="flex items-center gap-3 rounded-2xl border border-[#0A66C2]/20 bg-[#0A66C2]/5 px-5 py-4 transition-colors hover:bg-[#0A66C2]/10 cursor-pointer">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0A66C2]/10">
              <Linkedin className="h-4 w-4 text-[#0A66C2]" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-medium text-gray-900">
                LinkedIn Review Queue
              </p>
              <p className="text-[11px] text-gray-500">
                {linkedInReview.totalPending} connections need your review
                — possible matches, job changes, and partial name matches
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-[#0A66C2]" />
          </div>
        </Link>
      )}

      {/* Empty state */}
      {visibleGroups.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-50">
            <Check className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-lg font-medium text-gray-900">All clean!</p>
          <p className="mt-1 text-sm text-gray-400">No duplicate contacts were found.</p>
        </div>
      )}

      {/* Duplicate groups */}
      <div className="space-y-3">
        {visibleGroups.map((group) => {
          const isExpanded = expandedGroups.has(group.key);
          const primaryId = selectedPrimary[group.key] ?? getBestPrimary(group);

          return (
            <div
              key={group.key}
              className="rounded-2xl border border-gray-200 bg-white overflow-hidden"
            >
              {/* Group header */}
              <button
                onClick={() => toggleExpand(group.key)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                )}
                <Users className="h-4 w-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-900">
                    {group.contacts[0].name}
                  </span>
                  <span className="ml-2 text-xs text-gray-400">
                    {group.contacts.length} contacts
                  </span>
                </div>
                <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                  {matchTypeLabels[group.matchType] ?? group.matchType}
                </span>
                <span className="text-xs text-gray-400">
                  {group.contacts.map((c) => sourceLabels[c.source] ?? c.source).join(", ")}
                </span>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t border-gray-100 px-5 py-4">
                  <div className="mb-3 flex items-center gap-2 text-xs text-gray-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Select the primary contact to keep. Others will be merged into it.
                  </div>

                  <div className="space-y-2">
                    {group.contacts.map((contact) => {
                      const color = getAvatarColor(contact.name);
                      const isPrimary = contact.id === primaryId;

                      return (
                        <button
                          key={contact.id}
                          onClick={() => handleSelectPrimary(group.key, contact.id)}
                          className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all ${
                            isPrimary
                              ? "bg-gray-900 text-white ring-2 ring-gray-900"
                              : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                          }`}
                        >
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback
                              className="text-[10px] font-semibold"
                              style={
                                isPrimary
                                  ? { backgroundColor: "rgba(255,255,255,0.2)", color: "#fff" }
                                  : { backgroundColor: color.bg, color: color.text }
                              }
                            >
                              {getInitials(contact.name)}
                            </AvatarFallback>
                          </Avatar>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">
                                {contact.name}
                              </span>
                              {isPrimary && (
                                <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">
                                  PRIMARY
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] opacity-70">
                              {contact.email && <span>{contact.email}</span>}
                              {contact.phone && <span>{contact.phone}</span>}
                              {contact.company && <span>{contact.company}</span>}
                            </div>
                          </div>

                          <div className="shrink-0 text-right text-[11px] opacity-60 space-y-0.5">
                            <div>{sourceLabels[contact.source]}</div>
                            <div>{tierLabels[contact.tier]}</div>
                            <div>
                              {contact.interactionCount > 0
                                ? `${contact.interactionCount} interactions`
                                : "No interactions"}
                            </div>
                            {contact.lastInteraction && (
                              <div>
                                Last: {formatDistanceToNow(new Date(contact.lastInteraction))}
                              </div>
                            )}
                          </div>

                          {!isPrimary && (
                            <Trash2 className="h-3.5 w-3.5 shrink-0 opacity-40" />
                          )}
                          {isPrimary && (
                            <Check className="h-4 w-4 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => handleMergeGroup(group)}
                      disabled={mergeMutation.isPending}
                      className="gap-2"
                    >
                      {mergeMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Merge className="h-3.5 w-3.5" />
                      )}
                      Merge into {group.contacts.find((c) => c.id === primaryId)?.name}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
