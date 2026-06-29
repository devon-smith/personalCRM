"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles, Pencil, ArrowUpRight, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { useDraftComposer } from "@/lib/draft-composer-context";
import { deploymentFeatures } from "@/lib/deployment-features";

/**
 * /feed — ambient awareness of what's going on in the network.
 *
 * Distinct from the inbox (action-required) and the dashboard
 * observations (curated "notes from your assistant") — this is the
 * informational layer. Career changes, life events, publications,
 * news mentions. Scroll occasionally; no obligation, no badges
 * shouting at you.
 *
 * Sources: FeedItem rows written by the worker/tasks/feed-aggregate
 * task from ContactChangelog + LifeEventSignal.
 */

interface FeedItem {
  id: string;
  contactId: string;
  itemType:
    | "job_change"
    | "publication"
    | "news_mention"
    | "life_event"
    | "award"
    | "announcement";
  headline: string;
  body: string | null;
  sourceType: string;
  sourceRecordId: string;
  linkUrl: string | null;
  detectedAt: string;
  isHighlighted: boolean;
  contact: { name: string; company: string | null; tier: string };
}

type FilterType = "all" | "career" | "publications" | "news" | "life_events";

const FILTER_TO_TYPES: Record<FilterType, string[] | null> = {
  all: null,
  career: ["job_change"],
  publications: ["publication"],
  news: ["news_mention"],
  life_events: ["life_event", "award", "announcement"],
};

const FILTERS: Array<{ id: FilterType; label: string }> = [
  { id: "all", label: "All" },
  { id: "career", label: "Career" },
  { id: "publications", label: "Publications" },
  { id: "news", label: "News" },
  { id: "life_events", label: "Life events" },
];

export default function FeedPage() {
  if (!deploymentFeatures.feed) return <FeedDisabled />;
  return <FeedPageContent />;
}

function FeedPageContent() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterType>("all");
  const [highlightedOnly, setHighlightedOnly] = useState(false);

  // Mark the page as visited so the rail-nav dot indicator clears.
  // Fire-and-forget; the visit endpoint is non-critical.
  useEffect(() => {
    fetch("/api/feed/visit", { method: "POST" }).catch(() => {});
    // Invalidate the data-health-shaped query the rail nav reads
    // from (if there's one) so the dot clears in the same render.
    queryClient.invalidateQueries({ queryKey: ["feed-unseen"] });
  }, [queryClient]);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    const types = FILTER_TO_TYPES[filter];
    if (types && types.length > 0) {
      params.set("type", types.join(","));
    }
    if (highlightedOnly) params.set("highlighted", "1");
    return params.toString();
  }, [filter, highlightedOnly]);

  const { data, isLoading } = useQuery<{ items: FeedItem[]; cursor: string | null }>({
    queryKey: ["feed", filter, highlightedOnly],
    queryFn: async () => {
      const res = await fetch(`/api/feed?${queryParams}`);
      if (!res.ok) return { items: [], cursor: null };
      return res.json();
    },
    staleTime: 30 * 1000,
  });

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const grouped = useMemo(() => groupByTime(items), [items]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 sm:py-10">
      {/* Header */}
      <header className="mb-6 sm:mb-8">
        <h1
          className="ds-display-md"
          style={{ color: "var(--text-primary)" }}
        >
          Feed
        </h1>
        <p
          className="mt-1 text-[13px]"
          style={{ color: "var(--text-tertiary)" }}
        >
          What&rsquo;s going on in your network. Read whenever; no obligation.
        </p>
      </header>

      {/* Filter tabs */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <FilterTab
            key={f.id}
            active={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </FilterTab>
        ))}
        <span
          className="mx-1 inline-block h-4 w-px"
          style={{ backgroundColor: "var(--border)" }}
        />
        <FilterTab
          active={highlightedOnly}
          onClick={() => setHighlightedOnly((v) => !v)}
        >
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            Highlighted
          </span>
        </FilterTab>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2
            className="h-4 w-4 animate-spin"
            style={{ color: "var(--text-tertiary)" }}
          />
        </div>
      ) : items.length === 0 ? (
        <EmptyState filter={filter} highlightedOnly={highlightedOnly} />
      ) : (
        <div className="space-y-6">
          {grouped.map(({ group, items: groupItems }) => (
            <section key={group}>
              <p
                className="text-[11px] font-semibold uppercase tracking-wider mb-3"
                style={{
                  color: "var(--text-tertiary)",
                  letterSpacing: "0.06em",
                }}
              >
                {group}
              </p>
              <div className="space-y-2.5">
                {groupItems.map((item) => (
                  <FeedItemCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FeedDisabled() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 text-center sm:px-6">
      <div
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: "var(--surface-sunken)" }}
      >
        <Sparkles className="h-5 w-5" style={{ color: "var(--text-tertiary)" }} />
      </div>
      <h1 className="mt-4 ds-display-md" style={{ color: "var(--text-primary)" }}>
        Feed is disabled
      </h1>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-5" style={{ color: "var(--text-tertiary)" }}>
        This deployment keeps the main CRM focused on Gmail, Calendar, Replies, Ask, and meeting prep.
      </p>
      <Link
        href="/dashboard"
        className="mt-5 inline-flex rounded-[8px] px-4 py-2 text-[13px] font-semibold"
        style={{ backgroundColor: "var(--accent-color)", color: "var(--text-inverse)" }}
      >
        Back to Home
      </Link>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors"
      style={{
        backgroundColor: active ? "var(--surface)" : "transparent",
        color: active ? "var(--text-primary)" : "var(--text-tertiary)",
        border: active
          ? "1px solid var(--border)"
          : "1px solid transparent",
        letterSpacing: "-0.01em",
        transitionDuration: "var(--duration-fast)",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.color = "var(--text-secondary)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.color = "var(--text-tertiary)";
      }}
    >
      {children}
    </button>
  );
}

function FeedItemCard({ item }: { item: FeedItem }) {
  const queryClient = useQueryClient();
  const { openComposer } = useDraftComposer();
  const color = getAvatarColor(item.contact.name);
  const badge = badgeForType(item.itemType);

  const hideMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/feed/${encodeURIComponent(item.id)}/hide`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
    onError: () => toast.error("Couldn't hide"),
  });

  return (
    <div
      className="group rounded-2xl p-4 transition-colors"
      style={{
        backgroundColor: item.isHighlighted ? "var(--surface)" : "transparent",
        border: item.isHighlighted
          ? "1px solid var(--border)"
          : "1px solid transparent",
        transitionDuration: "var(--duration-fast)",
      }}
      onMouseEnter={(e) => {
        if (!item.isHighlighted) {
          e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
        }
      }}
      onMouseLeave={(e) => {
        if (!item.isHighlighted) {
          e.currentTarget.style.backgroundColor = "transparent";
        }
      }}
    >
      <div className="flex items-start gap-3">
        <Avatar
          className="h-10 w-10 shrink-0"
          style={
            item.isHighlighted
              ? { boxShadow: "0 0 0 2px var(--accent-soft)" }
              : undefined
          }
        >
          <AvatarFallback
            className="text-[12px] font-semibold"
            style={{ backgroundColor: color.bg, color: color.text }}
          >
            {getInitials(item.contact.name)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          {/* Name + event-type pill + time */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={`/people?contact=${item.contactId}`}
              className="text-[14px] font-semibold transition-colors"
              style={{
                color: "var(--text-primary)",
                letterSpacing: "-0.02em",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--accent-color)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-primary)";
              }}
            >
              {item.contact.name}
            </Link>
            <EventBadge label={badge.label} bg={badge.bg} fg={badge.fg} />
            <span
              className="text-[11.5px] tabular-nums"
              style={{ color: "var(--text-tertiary)" }}
            >
              {formatRelativeShort(new Date(item.detectedAt))}
            </span>
          </div>

          {/* Headline */}
          <p
            className="mt-1 text-[14px]"
            style={{
              color: "var(--text-secondary)",
              letterSpacing: "-0.01em",
              lineHeight: 1.45,
            }}
          >
            {item.headline}
          </p>
          {item.body && (
            <p
              className="mt-1 text-[12px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              {item.body}
            </p>
          )}

          {/* Actions — show on hover/focus on desktop; always on mobile */}
          <div
            className="mt-2 flex flex-wrap items-center gap-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity"
            style={{ transitionDuration: "180ms" }}
          >
            <button
              onClick={() =>
                openComposer({
                  contactId: item.contactId,
                  presetTone: presetToneForItem(item.itemType),
                  presetContext: presetContextForItem(item.itemType),
                })
              }
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors"
              style={{
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--accent-soft)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <Pencil className="h-3 w-3" />
              Draft note
            </button>
            <Link
              href={`/people?contact=${item.contactId}`}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors"
              style={{
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--accent-soft)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              Open contact
              <ArrowUpRight className="h-3 w-3" />
            </Link>
            {item.linkUrl && (
              <a
                href={item.linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors"
                style={{
                  border: "1px solid var(--border)",
                  color: "var(--text-secondary)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--accent-soft)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                Source
                <ArrowUpRight className="h-3 w-3" />
              </a>
            )}
            <button
              onClick={() => hideMutation.mutate()}
              disabled={hideMutation.isPending}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors"
              style={{ color: "var(--text-tertiary)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-tertiary)";
              }}
            >
              <X className="h-3 w-3" />
              Hide
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventBadge({
  label,
  bg,
  fg,
}: {
  label: string;
  bg: string;
  fg: string;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium"
      style={{
        backgroundColor: bg,
        color: fg,
        letterSpacing: "-0.01em",
      }}
    >
      {label}
    </span>
  );
}

function EmptyState({
  filter,
  highlightedOnly,
}: {
  filter: FilterType;
  highlightedOnly: boolean;
}) {
  const message =
    filter === "all" && !highlightedOnly
      ? "No updates from your network yet. Check back as sync catches up."
      : "Nothing matches this filter right now.";
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div
        className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: "var(--surface-sunken)" }}
      >
        <Sparkles
          className="h-4 w-4"
          style={{ color: "var(--text-tertiary)" }}
        />
      </div>
      <p
        className="text-[14px] font-medium"
        style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}
      >
        Your feed is quiet
      </p>
      <p
        className="text-[12px] mt-1 max-w-sm"
        style={{ color: "var(--text-tertiary)" }}
      >
        {message}
      </p>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function presetToneForItem(
  type: FeedItem["itemType"],
): "casual" | "warm" | "professional" | "congratulatory" | "checking_in" {
  switch (type) {
    case "job_change":
    case "award":
    case "publication":
      return "congratulatory";
    case "life_event":
      return "warm";
    default:
      return "warm";
  }
}

function presetContextForItem(
  type: FeedItem["itemType"],
): "reply_email" | "catching_up" | "congratulate" | "ask" | "follow_up" {
  switch (type) {
    case "job_change":
    case "award":
    case "publication":
    case "life_event":
      return "congratulate";
    default:
      return "catching_up";
  }
}

function badgeForType(type: FeedItem["itemType"]): {
  label: string;
  bg: string;
  fg: string;
} {
  switch (type) {
    case "job_change":
      return { label: "New role", bg: "#F0E5DC", fg: "#7A4F3C" }; // sand
    case "publication":
      return { label: "Publication", bg: "#DCE3EF", fg: "#3C4F7A" }; // mist
    case "news_mention":
      return { label: "News", bg: "#E5DCEF", fg: "#5F3C7A" }; // mauve
    case "life_event":
      return { label: "Life event", bg: "#F0DCDC", fg: "#7A3C3C" }; // coral
    case "award":
      return { label: "Award", bg: "#DCEFE2", fg: "#3C7A4F" }; // teal
    default:
      return { label: "Update", bg: "#EFEAE0", fg: "#5A574F" }; // neutral
  }
}

function groupByTime(items: FeedItem[]): Array<{
  group: "TODAY" | "THIS WEEK" | "THIS MONTH" | "EARLIER";
  items: FeedItem[];
}> {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const buckets: Record<"TODAY" | "THIS WEEK" | "THIS MONTH" | "EARLIER", FeedItem[]> = {
    TODAY: [],
    "THIS WEEK": [],
    "THIS MONTH": [],
    EARLIER: [],
  };
  for (const item of items) {
    const age = now - new Date(item.detectedAt).getTime();
    if (age < day) buckets["TODAY"].push(item);
    else if (age < 7 * day) buckets["THIS WEEK"].push(item);
    else if (age < 30 * day) buckets["THIS MONTH"].push(item);
    else buckets["EARLIER"].push(item);
  }
  const order: Array<"TODAY" | "THIS WEEK" | "THIS MONTH" | "EARLIER"> = [
    "TODAY",
    "THIS WEEK",
    "THIS MONTH",
    "EARLIER",
  ];
  return order
    .map((group) => ({ group, items: buckets[group] }))
    .filter((entry) => entry.items.length > 0);
}

function formatRelativeShort(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}
