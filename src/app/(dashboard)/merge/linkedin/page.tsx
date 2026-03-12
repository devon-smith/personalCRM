"use client";

import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Linkedin,
  Loader2,
  Check,
  X,
  UserPlus,
  Link2,
  ChevronLeft,
  Briefcase,
  UserCheck,
  HelpCircle,
  ArrowRight,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { formatDistanceToNow } from "@/lib/date-utils";
import type {
  LinkedInReviewResponse,
  LinkedInReviewItem,
} from "@/app/api/import/linkedin/review/route";

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

type FilterCategory = "all" | "job_change" | "name_match" | "partial_match";

export default function LinkedInReviewPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterCategory>("all");
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState(0);

  const { data, isLoading } = useQuery<LinkedInReviewResponse>({
    queryKey: ["linkedin-review"],
    queryFn: async () => {
      const res = await fetch("/api/import/linkedin/review");
      if (!res.ok) throw new Error("Failed to fetch review queue");
      return res.json();
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (params: {
      sightingId: string;
      action: "link" | "create" | "dismiss";
      updateCompany?: boolean;
    }) => {
      const res = await fetch("/api/import/linkedin/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Action failed");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      setResolvedIds((prev) => new Set([...prev, variables.sightingId]));
      queryClient.invalidateQueries({ queryKey: ["contacts"] });

      const actionLabels: Record<string, string> = {
        link: "Linked to contact",
        create: "Created new contact",
        dismiss: "Dismissed",
      };
      toast.success(actionLabels[variables.action]);
    },
    onError: (err) => toast.error(err.message),
  });

  const bulkResolveMutation = useMutation({
    mutationFn: async (params: {
      items: LinkedInReviewItem[];
      action: "link" | "create" | "dismiss";
    }) => {
      const results: string[] = [];
      for (const item of params.items) {
        const res = await fetch("/api/import/linkedin/review", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sightingId: item.id,
            action: params.action,
            updateCompany: params.action === "link" && item.category === "job_change",
          }),
        });
        if (res.ok) results.push(item.id);
      }
      return results;
    },
    onSuccess: (resolvedItemIds) => {
      setResolvedIds((prev) => {
        const next = new Set(prev);
        resolvedItemIds.forEach((id) => next.add(id));
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["linkedin-review"] });
      toast.success(`Resolved ${resolvedItemIds.length} items`);
    },
    onError: (err) => toast.error(err.message),
  });

  // Filter visible items
  const allItems = data?.items ?? [];
  const visibleItems = allItems
    .filter((i) => !resolvedIds.has(i.id))
    .filter((i) => filter === "all" || i.category === filter);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (visibleItems.length === 0) return;
      const item = visibleItems[activeIndex];
      if (!item) return;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, visibleItems.length - 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "l" && item.candidate) {
        e.preventDefault();
        resolveMutation.mutate({
          sightingId: item.id,
          action: "link",
          updateCompany: item.category === "job_change",
        });
      } else if (e.key === "n") {
        e.preventDefault();
        resolveMutation.mutate({ sightingId: item.id, action: "create" });
      } else if (e.key === "d") {
        e.preventDefault();
        resolveMutation.mutate({ sightingId: item.id, action: "dismiss" });
      }
    },
    [visibleItems, activeIndex, resolveMutation],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Keep activeIndex in bounds
  useEffect(() => {
    if (activeIndex >= visibleItems.length && visibleItems.length > 0) {
      setActiveIndex(visibleItems.length - 1);
    }
  }, [activeIndex, visibleItems.length]);

  if (isLoading) {
    return (
      <div className="pt-14">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading review queue...
        </div>
      </div>
    );
  }

  return (
    <div className="pt-14 pb-12">
      {/* Header */}
      <div className="crm-animate-enter">
        <Link
          href="/merge"
          className="inline-flex items-center gap-1 text-[12px] text-gray-400 hover:text-gray-600 transition-colors mb-3"
        >
          <ChevronLeft className="h-3 w-3" />
          Back to Merge
        </Link>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0A66C2]/10">
              <Linkedin className="h-4.5 w-4.5 text-[#0A66C2]" />
            </div>
            <div>
              <h1
                className="text-[22px] font-semibold text-[#1A1A1A]"
                style={{ letterSpacing: "-0.03em" }}
              >
                LinkedIn Review
              </h1>
              <p className="text-[12px] text-gray-400">
                {visibleItems.length} items need your review
              </p>
            </div>
          </div>

          {/* Keyboard hints */}
          <div className="hidden md:flex items-center gap-3 text-[10px] text-gray-400">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-500">j/k</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-500">l</kbd>
              link
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-500">n</kbd>
              new
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-500">d</kbd>
              dismiss
            </span>
          </div>
        </div>
      </div>

      {/* Category filter tabs + summary */}
      {data && data.totalPending > 0 && (
        <div className="crm-animate-enter mt-5 flex items-center gap-2" style={{ animationDelay: "40ms" }}>
          <FilterTab
            label="All"
            count={allItems.filter((i) => !resolvedIds.has(i.id)).length}
            active={filter === "all"}
            onClick={() => { setFilter("all"); setActiveIndex(0); }}
          />
          {data.summary.jobChanges > 0 && (
            <FilterTab
              label="Job changes"
              count={data.summary.jobChanges}
              active={filter === "job_change"}
              onClick={() => { setFilter("job_change"); setActiveIndex(0); }}
              icon={<Briefcase className="h-3 w-3" />}
              color="text-amber-600 bg-amber-50"
            />
          )}
          {data.summary.nameMatches > 0 && (
            <FilterTab
              label="Name matches"
              count={data.summary.nameMatches}
              active={filter === "name_match"}
              onClick={() => { setFilter("name_match"); setActiveIndex(0); }}
              icon={<UserCheck className="h-3 w-3" />}
              color="text-blue-600 bg-blue-50"
            />
          )}
          {data.summary.partialMatches > 0 && (
            <FilterTab
              label="Partial"
              count={data.summary.partialMatches}
              active={filter === "partial_match"}
              onClick={() => { setFilter("partial_match"); setActiveIndex(0); }}
              icon={<HelpCircle className="h-3 w-3" />}
              color="text-gray-500 bg-gray-50"
            />
          )}

          {/* Bulk actions */}
          <div className="ml-auto flex gap-1.5">
            {filter === "name_match" && visibleItems.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] gap-1"
                onClick={() => bulkResolveMutation.mutate({ items: visibleItems, action: "link" })}
                disabled={bulkResolveMutation.isPending}
              >
                {bulkResolveMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Link2 className="h-3 w-3" />
                )}
                Link all {visibleItems.length}
              </Button>
            )}
            {filter !== "all" && visibleItems.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] gap-1 text-gray-400"
                onClick={() => bulkResolveMutation.mutate({ items: visibleItems, action: "dismiss" })}
                disabled={bulkResolveMutation.isPending}
              >
                Dismiss all
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {visibleItems.length === 0 && (
        <div className="flex flex-col items-center py-20 text-center crm-animate-enter">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
            <Check className="h-6 w-6 text-green-500" />
          </div>
          <p className="text-[16px] font-medium text-gray-900">All reviewed!</p>
          <p className="mt-1 text-[13px] text-gray-400">
            No LinkedIn connections need your review.
          </p>
          <Link href="/merge">
            <Button variant="outline" size="sm" className="mt-4 gap-1.5">
              <ChevronLeft className="h-3 w-3" />
              Back to Merge
            </Button>
          </Link>
        </div>
      )}

      {/* Review items list */}
      <div className="mt-4 space-y-2 crm-stagger">
        {visibleItems.map((item, idx) => (
          <ReviewCard
            key={item.id}
            item={item}
            isActive={idx === activeIndex}
            isPending={resolveMutation.isPending}
            onLink={(updateCompany) =>
              resolveMutation.mutate({
                sightingId: item.id,
                action: "link",
                updateCompany,
              })
            }
            onCreate={() =>
              resolveMutation.mutate({ sightingId: item.id, action: "create" })
            }
            onDismiss={() =>
              resolveMutation.mutate({ sightingId: item.id, action: "dismiss" })
            }
            onClick={() => setActiveIndex(idx)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Filter tab ─────────────────────────────────────────────

function FilterTab({
  label,
  count,
  active,
  onClick,
  icon,
  color,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all ${
        active
          ? "bg-gray-900 text-white shadow-sm"
          : color ?? "text-gray-500 bg-gray-50 hover:bg-gray-100"
      }`}
    >
      {icon}
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] ${
          active ? "bg-white/20" : "bg-black/5"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

// ─── Review card ────────────────────────────────────────────

function ReviewCard({
  item,
  isActive,
  isPending,
  onLink,
  onCreate,
  onDismiss,
  onClick,
}: {
  item: LinkedInReviewItem;
  isActive: boolean;
  isPending: boolean;
  onLink: (updateCompany: boolean) => void;
  onCreate: () => void;
  onDismiss: () => void;
  onClick: () => void;
}) {
  const candidate = item.candidate;
  const sightingColor = getAvatarColor(item.sightingName);
  const candidateColor = candidate ? getAvatarColor(candidate.name) : null;

  const categoryIcon =
    item.category === "job_change" ? (
      <Briefcase className="h-3 w-3 text-amber-500" />
    ) : item.category === "name_match" ? (
      <UserCheck className="h-3 w-3 text-blue-500" />
    ) : (
      <HelpCircle className="h-3 w-3 text-gray-400" />
    );

  const categoryBg =
    item.category === "job_change"
      ? "bg-amber-50 border-amber-100"
      : item.category === "name_match"
        ? "bg-blue-50 border-blue-100"
        : "bg-gray-50 border-gray-100";

  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border transition-all cursor-pointer ${
        isActive
          ? `ring-2 ring-gray-900 ring-offset-1 ${categoryBg}`
          : `${categoryBg} hover:shadow-sm`
      }`}
    >
      {/* Category label */}
      <div className="flex items-center gap-2 px-5 pt-3.5 pb-1">
        {categoryIcon}
        <span className="text-[11px] font-medium text-gray-500">
          {item.categoryLabel}
        </span>
        <span className="ml-auto text-[10px] text-gray-400">
          {Math.round(item.confidence * 100)}% match
        </span>
      </div>

      {/* Side-by-side comparison */}
      <div className="flex items-stretch gap-3 px-5 py-3">
        {/* LinkedIn sighting (left) */}
        <div className="flex-1 rounded-xl bg-white p-3 border border-gray-100">
          <div className="flex items-center gap-1.5 mb-2">
            <Linkedin className="h-3 w-3 text-[#0A66C2]" />
            <span className="text-[10px] font-medium text-[#0A66C2]">LinkedIn</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarFallback
                className="text-[11px] font-semibold"
                style={{ backgroundColor: sightingColor.bg, color: sightingColor.text }}
              >
                {getInitials(item.sightingName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-gray-900 truncate">
                {item.sightingName}
              </p>
              {item.sightingRole && (
                <p className="text-[11px] text-gray-500 truncate">{item.sightingRole}</p>
              )}
              {item.sightingCompany && (
                <p className="text-[11px] text-gray-500 truncate">{item.sightingCompany}</p>
              )}
            </div>
          </div>
          <div className="mt-2 space-y-0.5">
            {item.sightingEmail && (
              <p className="text-[10px] text-gray-400">{item.sightingEmail}</p>
            )}
            {item.sightingLinkedinUrl && (
              <a
                href={item.sightingLinkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[10px] text-[#0A66C2] hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Profile <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
            {item.sightingConnectedOn && (
              <p className="text-[10px] text-gray-400">
                Connected: {item.sightingConnectedOn}
              </p>
            )}
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-center">
          <ArrowRight className="h-4 w-4 text-gray-300" />
        </div>

        {/* Existing contact (right) */}
        <div className="flex-1 rounded-xl bg-white p-3 border border-gray-100">
          {candidate ? (
            <>
              <div className="flex items-center gap-1.5 mb-2">
                <span
                  className="text-[10px] font-medium"
                  style={{ color: "var(--crm-text-tertiary)" }}
                >
                  Your contact
                </span>
                <Badge
                  variant="outline"
                  className="text-[9px] h-4 px-1 border-gray-200 text-gray-400"
                >
                  {sourceLabels[candidate.source] ?? candidate.source}
                </Badge>
              </div>
              <div className="flex items-center gap-2.5">
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback
                    className="text-[11px] font-semibold"
                    style={{
                      backgroundColor: candidateColor!.bg,
                      color: candidateColor!.text,
                    }}
                  >
                    {getInitials(candidate.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-gray-900 truncate">
                    {candidate.name}
                  </p>
                  {candidate.role && (
                    <p className="text-[11px] text-gray-500 truncate">{candidate.role}</p>
                  )}
                  {candidate.company && (
                    <p className="text-[11px] text-gray-500 truncate">{candidate.company}</p>
                  )}
                </div>
              </div>
              <div className="mt-2 space-y-0.5">
                {candidate.email && (
                  <p className="text-[10px] text-gray-400">{candidate.email}</p>
                )}
                {candidate.phone && (
                  <p className="text-[10px] text-gray-400">{candidate.phone}</p>
                )}
                {candidate.linkedinUrl && (
                  <a
                    href={candidate.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-[10px] text-[#0A66C2] hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Has LinkedIn <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
                <div className="flex gap-2 text-[10px] text-gray-400">
                  <span>{tierLabels[candidate.tier]}</span>
                  <span>&middot;</span>
                  <span>
                    {candidate.interactionCount > 0
                      ? `${candidate.interactionCount} interactions`
                      : "No interactions"}
                  </span>
                  {candidate.lastInteraction && (
                    <>
                      <span>&middot;</span>
                      <span>
                        Last: {formatDistanceToNow(new Date(candidate.lastInteraction))}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-gray-400">
              No candidate match
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 px-5 pb-3.5">
        {candidate && (
          <>
            <Button
              size="sm"
              className="h-7 text-[11px] gap-1.5 rounded-lg"
              onClick={(e) => {
                e.stopPropagation();
                onLink(item.category === "job_change");
              }}
              disabled={isPending}
            >
              <Link2 className="h-3 w-3" />
              {item.category === "job_change" ? "Link + update company" : "Link"}
            </Button>
            {item.category === "job_change" && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] gap-1 rounded-lg"
                onClick={(e) => {
                  e.stopPropagation();
                  onLink(false);
                }}
                disabled={isPending}
              >
                <Link2 className="h-3 w-3" />
                Link (keep old company)
              </Button>
            )}
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] gap-1 rounded-lg"
          onClick={(e) => {
            e.stopPropagation();
            onCreate();
          }}
          disabled={isPending}
        >
          <UserPlus className="h-3 w-3" />
          Create new
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[11px] gap-1 rounded-lg text-gray-400 ml-auto"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          disabled={isPending}
        >
          <X className="h-3 w-3" />
          Dismiss
        </Button>
      </div>
    </div>
  );
}
