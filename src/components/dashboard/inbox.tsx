"use client";

import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mail,
  MessageCircle,
  Clock,
  Check,
  Loader2,
  RefreshCw,
  ChevronDown,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  Linkedin,
  Bell,
  ExternalLink,
  Pencil,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { formatDistanceToNow } from "@/lib/date-utils";
import { EvidenceChevron } from "@/components/shared/evidence-chevron";
import { useSessionExpanded } from "@/components/ds";
import { useDraftComposer } from "@/lib/draft-composer-context";
import { trimToShortPhrase } from "@/lib/inbox/response-classifier";
import { deploymentFeatures } from "@/lib/deployment-features";

// ─── Swipe gesture hook ─────────────────────────────────────

const SWIPE_THRESHOLD = 80;

function useSwipe(onSwipeRight: () => void, onSwipeLeft: () => void) {
  const startX = useRef(0);
  const currentX = useRef(0);
  const swiping = useRef(false);
  const [offset, setOffset] = useState(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    swiping.current = true;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swiping.current) return;
    currentX.current = e.touches[0].clientX;
    const diff = currentX.current - startX.current;
    // Dampen the swipe beyond threshold
    const dampened = Math.sign(diff) * Math.min(Math.abs(diff), 120);
    setOffset(dampened);
  }, []);

  const onTouchEnd = useCallback(() => {
    swiping.current = false;
    if (offset > SWIPE_THRESHOLD) {
      onSwipeRight();
    } else if (offset < -SWIPE_THRESHOLD) {
      onSwipeLeft();
    }
    setOffset(0);
  }, [offset, onSwipeRight, onSwipeLeft]);

  return { offset, onTouchStart, onTouchMove, onTouchEnd };
}

// ─── Pull-to-refresh hook ───────────────────────────────────

function usePullToRefresh(onRefresh: () => Promise<void> | void) {
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (containerRef.current && containerRef.current.scrollTop === 0) {
      startY.current = e.touches[0].clientY;
      setPulling(true);
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pulling) return;
    const diff = e.touches[0].clientY - startY.current;
    if (diff > 0) {
      setPullDistance(Math.min(diff * 0.5, 80));
    }
  }, [pulling]);

  const onTouchEnd = useCallback(async () => {
    setPulling(false);
    if (pullDistance > 50 && !refreshing) {
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    }
    setPullDistance(0);
  }, [pullDistance, refreshing, onRefresh]);

  return { containerRef, pullDistance, refreshing, onTouchStart, onTouchMove, onTouchEnd };
}

// ─── Types ───────────────────────────────────────────────────

interface MessagePreview {
  summary: string;
  occurredAt: string;
  channel: string;
}

interface InboxItemData {
  id: string;
  contactId: string;
  contactName: string;
  company: string | null;
  tier: string;
  channel: string;
  threadKey: string;
  isGroupChat: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
  contactLinkedinUrl: string | null;
  triggerAt: string;
  lastInboundAt?: string;
  messagePreview: MessagePreview[] | null;
  messageCount: number;
  status: string;
  hasDraft?: boolean;
  priority?: "high" | "medium" | "low";
  priorityScore?: number;
  priorityReason?: string;
  sourceSystem?: string | null;
  sourceRecordIds?: string[];
  triggerInteractionId?: string;
  // M0.x.2 classifier output
  needsResponse?: boolean | null;
  responseConfidence?: number | null;
  responseReason?: string | null;
  responseCategory?: string | null;
  classifiedAt?: string | null;
}

interface InboxItemsData {
  items: InboxItemData[];
  totalOpen: number;
  groupChats: InboxItemData[];
  totalGroupChats: number;
  filteredOut?: number;
  view?: "needs-reply" | "all";
  /** M0.x.8: count for each side of the toggle so both chips render. */
  needsReplyCount?: number;
  allInboundCount?: number;
}

function removeItemFromInboxData(
  data: InboxItemsData | undefined,
  itemId: string,
): InboxItemsData | undefined {
  if (!data) return data;
  const itemWasOpen = data.items.some((item) => item.id === itemId);
  const groupWasOpen = data.groupChats.some((item) => item.id === itemId);
  return {
    ...data,
    items: data.items.filter((item) => item.id !== itemId),
    totalOpen: itemWasOpen ? Math.max(data.totalOpen - 1, 0) : data.totalOpen,
    groupChats: data.groupChats.filter((item) => item.id !== itemId),
    totalGroupChats: groupWasOpen
      ? Math.max(data.totalGroupChats - 1, 0)
      : data.totalGroupChats,
  };
}

function restoreInboxSnapshots(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshots: Array<readonly [readonly unknown[], InboxItemsData | undefined]>,
) {
  snapshots.forEach(([queryKey, data]) => {
    queryClient.setQueryData(queryKey, data);
  });
}

interface ActivityItem {
  id: string;
  type: string;
  direction: string | null;
  channel: string | null;
  subject: string | null;
  summary: string | null;
  occurredAt: string;
  contactId: string;
  contactName: string;
  contactCompany: string | null;
}

interface MessageActionItem {
  id: string;
  status: string;
  title: string;
  classification: string;
  urgency: string;
  reasoning: string;
  channel: string | null;
  preview: string | null;
  contactId: string | null;
  contactName: string | null;
  occurredAt: string | null;
  extractedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────

function ChannelIcon({ channel, size = 14 }: { channel: string; size?: number }) {
  const cls = `shrink-0`;
  const style = { width: size, height: size };
  if (channel === "gmail" || channel === "email")
    return <Mail className={cls} style={style} />;
  if (channel === "linkedin")
    return <Linkedin className={cls} style={style} />;
  return <MessageCircle className={cls} style={style} />;
}

const CHANNEL_DOT_COLORS: Record<string, string> = {
  text: "#34C759",
  iMessage: "#34C759",
  SMS: "#34C759",
  email: "#EA4335",
  gmail: "#EA4335",
  linkedin: "#0A66C2",
  calendar: "#7C3AED",
};

function getReplyUrl(item: InboxItemData): string | null {
  const ch = item.channel;
  if ((ch === "text" || ch === "iMessage" || ch === "SMS") && item.contactPhone) {
    return `sms:${item.contactPhone}`;
  }
  if ((ch === "email" || ch === "gmail") && item.contactEmail) {
    return `mailto:${item.contactEmail}`;
  }
  if (ch === "linkedin" && item.contactLinkedinUrl) {
    return item.contactLinkedinUrl;
  }
  return null;
}

// ─── Time grouping ───────────────────────────────────────────

type TimeGroup = "Today" | "Yesterday" | "This week" | "Older";

function getTimeGroup(isoDate: string): TimeGroup {
  const date = new Date(isoDate);
  const now = new Date();

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);

  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  if (date >= weekAgo) return "This week";
  return "Older";
}

function groupByTime<T extends { occurredAt?: string; lastInboundAt?: string }>(
  items: T[],
): { group: TimeGroup; items: T[] }[] {
  const order: TimeGroup[] = ["Today", "Yesterday", "This week", "Older"];
  const map = new Map<TimeGroup, T[]>();

  for (const item of items) {
    const dateStr = ("lastInboundAt" in item ? item.lastInboundAt : item.occurredAt) ?? "";
    const group = getTimeGroup(dateStr);
    const list = map.get(group) ?? [];
    list.push(item);
    map.set(group, list);
  }

  return order
    .filter((g) => map.has(g))
    .map((g) => ({ group: g, items: map.get(g)! }));
}

// ─── Snooze options ──────────────────────────────────────────

const SNOOZE_OPTIONS = [
  { label: "1 hour", hours: 1 },
  { label: "4 hours", hours: 4 },
  { label: "Tomorrow", hours: 14 },
  { label: "Next week", hours: 168 },
] as const;

// ─── Classification styles ──────────────────────────────────

const urgencyColors: Record<string, { bg: string; text: string }> = {
  high: { bg: "rgba(220,38,38,0.08)", text: "#DC2626" },
  medium: { bg: "rgba(217,119,6,0.08)", text: "#D97706" },
  low: { bg: "rgba(107,114,128,0.06)", text: "#6B7280" },
};

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export function Inbox() {
  const queryClient = useQueryClient();
  const showActivity = deploymentFeatures.activity;
  const [activeTab, setActiveTab] = useState<"inbox" | "groups" | "activity">("inbox");
  // M0.x.2 — "Needs reply" (default) vs "All inbound". Local state
  // is fine; the server query keys off this and React Query caches
  // per-key, so flipping the toggle returns instantly the second
  // time. Reload starts on "Needs reply" by design.
  const [inboxView, setInboxView] =
    useState<"needs-reply" | "all">("needs-reply");
  // Session-scoped (preserves across SPA route changes within the
  // tab; full reload starts collapsed per the "dashboard starts
  // calm" rule).
  const [showAll, toggleShowAll] = useSessionExpanded(
    "dashboard-inbox-expanded",
  );

  // ─── Data fetching ──────────────────────────────────────────

  const {
    data: inboxData,
    isLoading: loadingNR,
    isFetching: fetchingInbox,
    dataUpdatedAt: inboxUpdatedAt,
    refetch: refetchInbox,
  } = useQuery<InboxItemsData>({
    queryKey: ["inbox-items", inboxView],
    queryFn: async () => {
      const params = inboxView === "all" ? "?view=all" : "";
      const res = await fetch(`/api/inbox-items${params}`);
      if (!res.ok) return { items: [], totalOpen: 0, groupChats: [], totalGroupChats: 0 };
      return res.json();
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: activityData, isLoading: loadingActivity } = useQuery<{
    items: ActivityItem[];
  }>({
    queryKey: ["activity"],
    queryFn: async () => {
      const res = await fetch("/api/activity");
      if (!res.ok) return { items: [] };
      return res.json();
    },
    enabled: showActivity && activeTab === "activity",
  });

  // ─── Mutations ──────────────────────────────────────────────

  const syncMutation = useMutation({
    mutationFn: async () => {
      await Promise.all([
        fetch("/api/gmail/sync", { method: "POST" }),
      ]);
      await Promise.all([
        fetch("/api/message-actions", { method: "POST" }),
        fetch("/api/gmail/extract-actions", { method: "POST" }),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["message-actions"] });
      toast("Synced and scanned for new items");
    },
    onError: () => toast.error("Sync failed"),
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ itemId, channel }: { itemId: string; channel: string }) => {
      const res = await fetch(`/api/inbox-items/${encodeURIComponent(itemId)}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onMutate: async ({ itemId }) => {
      await queryClient.cancelQueries({ queryKey: ["inbox-items"] });
      const snapshots = queryClient.getQueriesData<InboxItemsData>({
        queryKey: ["inbox-items"],
      });
      queryClient.setQueriesData<InboxItemsData>(
        { queryKey: ["inbox-items"] },
        (prev) => removeItemFromInboxData(prev, itemId),
      );
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        restoreInboxSnapshots(queryClient, context.snapshots);
      }
      toast.error("Failed to mark as replied");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async ({ itemId, channel }: { itemId: string; channel: string }) => {
      const res = await fetch(`/api/inbox-items/${encodeURIComponent(itemId)}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onMutate: async ({ itemId }) => {
      await queryClient.cancelQueries({ queryKey: ["inbox-items"] });
      const snapshots = queryClient.getQueriesData<InboxItemsData>({
        queryKey: ["inbox-items"],
      });
      queryClient.setQueriesData<InboxItemsData>(
        { queryKey: ["inbox-items"] },
        (prev) => removeItemFromInboxData(prev, itemId),
      );
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        restoreInboxSnapshots(queryClient, context.snapshots);
      }
      toast.error("Failed to dismiss");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
    },
  });

  const snoozeMutation = useMutation({
    mutationFn: async (args: { itemId: string; hours: number; channel: string }) => {
      const res = await fetch(`/api/inbox-items/${encodeURIComponent(args.itemId)}/snooze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours: args.hours, channel: args.channel }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onMutate: async ({ itemId }) => {
      await queryClient.cancelQueries({ queryKey: ["inbox-items"] });
      const snapshots = queryClient.getQueriesData<InboxItemsData>({
        queryKey: ["inbox-items"],
      });
      queryClient.setQueriesData<InboxItemsData>(
        { queryKey: ["inbox-items"] },
        (prev) => removeItemFromInboxData(prev, itemId),
      );
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        restoreInboxSnapshots(queryClient, context.snapshots);
      }
      toast.error("Failed to snooze");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
    },
  });

  const bulkResolveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/inbox-items/bulk-resolve", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed");
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["inbox-items"] });
      const snapshots = queryClient.getQueriesData<InboxItemsData>({
        queryKey: ["inbox-items"],
      });
      queryClient.setQueriesData<InboxItemsData>(
        { queryKey: ["inbox-items"] },
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: [],
            totalOpen: 0,
            groupChats: [],
            totalGroupChats: 0,
          };
        },
      );
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        restoreInboxSnapshots(queryClient, context.snapshots);
      }
      toast.error("Failed to clear inbox");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  // Classifier override — "Doesn't need a reply". Flips InboxItem.needsResponse=false
  // and writes a ClassifierFeedback row. In the default Needs-reply view
  // the item disappears optimistically; in the All-inbound view it
  // stays but its row de-emphasizes (handled in InboxRow).
  const overrideMutation = useMutation({
    mutationFn: async (args: { itemId: string; needsResponse: boolean }) => {
      const res = await fetch(
        `/api/inbox-items/${encodeURIComponent(args.itemId)}/override`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ needsResponse: args.needsResponse }),
        },
      );
      if (!res.ok) throw new Error("Failed");
    },
    onMutate: async ({ itemId, needsResponse }) => {
      await queryClient.cancelQueries({ queryKey: ["inbox-items"] });
      const prev = queryClient.getQueryData<InboxItemsData>([
        "inbox-items",
        inboxView,
      ]);
      if (prev) {
        const shouldHide = inboxView === "needs-reply" && !needsResponse;
        queryClient.setQueryData<InboxItemsData>(
          ["inbox-items", inboxView],
          {
            ...prev,
            items: shouldHide
              ? prev.items.filter((i) => i.id !== itemId)
              : prev.items.map((i) =>
                  i.id === itemId ? { ...i, needsResponse } : i,
                ),
            groupChats: shouldHide
              ? (prev.groupChats ?? []).filter((i) => i.id !== itemId)
              : (prev.groupChats ?? []).map((i) =>
                  i.id === itemId ? { ...i, needsResponse } : i,
                ),
            filteredOut:
              (prev.filteredOut ?? 0) + (shouldHide ? 1 : 0),
          },
        );
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(["inbox-items", inboxView], context.prev);
      }
      toast.error("Couldn't save your override");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
    },
  });

  // ─── Derived data ───────────────────────────────────────────

  // Items arrive pre-sorted by priorityScore DESC from the API (drafts deprioritized)
  const waitingItems = inboxData?.items ?? [];
  const groupChatItems = inboxData?.groupChats ?? [];
  const activityItems = activityData?.items ?? [];
  const inboxCount = waitingItems.length;
  const groupCount = groupChatItems.length;
  const isLoading =
    activeTab === "activity"
      ? loadingActivity
      : loadingNR;

  return (
    <div
      className="crm-card overflow-hidden"
      style={{ backgroundColor: "#F1ECDE" }}
    >
      {/* ─── Tab bar ────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 sm:px-6 pt-5 pb-0"
      >
        <div
          className="flex items-center gap-1 rounded-full p-1"
          style={{
            // Hardcoded darker tan (sand has near-zero contrast with the
            // sand card behind it — the track read as invisible, making
            // only the active white tab look like a floating pill).
            backgroundColor: "#D6CFC2",
          }}
        >
          <button
            onClick={() => setActiveTab("inbox")}
            className="relative flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all"
            style={{
              backgroundColor:
                activeTab === "inbox" ? "#FFFFFF" : "transparent",
              color:
                activeTab === "inbox"
                  ? "var(--text-primary)"
                  : "var(--text-tertiary)",
              boxShadow:
                activeTab === "inbox"
                  ? "0 1px 3px rgba(0,0,0,0.06)"
                  : "none",
              transitionDuration: "var(--duration-fast)",
              letterSpacing: "-0.01em",
            }}
          >
            Inbox
            {inboxCount > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums"
                style={{
                  backgroundColor:
                    activeTab === "inbox"
                      ? "var(--accent-color)"
                      : "var(--text-tertiary)",
                  color: "var(--text-inverse)",
                }}
              >
                {inboxCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("groups")}
            className="relative flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all"
            style={{
              backgroundColor:
                activeTab === "groups" ? "#FFFFFF" : "transparent",
              color:
                activeTab === "groups"
                  ? "var(--text-primary)"
                  : "var(--text-tertiary)",
              boxShadow:
                activeTab === "groups"
                  ? "0 1px 3px rgba(0,0,0,0.06)"
                  : "none",
              transitionDuration: "var(--duration-fast)",
              letterSpacing: "-0.01em",
            }}
          >
            Groups
            {groupCount > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums"
                style={{
                  backgroundColor:
                    activeTab === "groups" ? "var(--accent-color)" : "var(--text-tertiary)",
                  color: "var(--text-inverse)",
                }}
              >
                {groupCount}
              </span>
            )}
          </button>
          {showActivity && (
            <button
              onClick={() => setActiveTab("activity")}
              className="rounded-full px-4 py-1.5 text-[13px] font-medium transition-all"
              style={{
                backgroundColor:
                  activeTab === "activity"
                    ? "#FFFFFF"
                    : "transparent",
                color:
                  activeTab === "activity"
                    ? "var(--text-primary)"
                    : "var(--text-tertiary)",
                boxShadow:
                  activeTab === "activity"
                    ? "0 1px 3px rgba(0,0,0,0.06)"
                    : "none",
                transitionDuration: "var(--duration-fast)",
                letterSpacing: "-0.01em",
              }}
            >
              History
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {inboxUpdatedAt > 0 && (
            <span
              className="hidden text-[11px] sm:inline"
              style={{ color: "var(--text-tertiary)" }}
            >
              Updated {formatDistanceToNow(new Date(inboxUpdatedAt))}
            </span>
          )}
          <button
            onClick={() => void refetchInbox()}
            disabled={fetchingInbox && !loadingNR}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              color: "var(--text-tertiary)",
              transitionDuration: "var(--duration-fast)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "";
              e.currentTarget.style.color = "var(--text-tertiary)";
            }}
          >
            {fetchingInbox && !loadingNR ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </button>
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              backgroundColor: "var(--text-primary)",
              color: "var(--text-inverse)",
              transitionDuration: "var(--duration-fast)",
            }}
          >
            {syncMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {syncMutation.isPending ? "Syncing..." : "Sync Gmail"}
          </button>
        </div>
      </div>

      {/* ─── Tab content with pull-to-refresh ─────────────────── */}
      <PullToRefreshWrapper
        onRefresh={async () => {
          await refetchInbox();
        }}
      >
      <div className="px-4 sm:px-6 pt-4 pb-5">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12">
            <Loader2
              className="h-4 w-4 animate-spin"
              style={{ color: "var(--text-tertiary)" }}
            />
            <span
              className="text-[13px]"
              style={{ color: "var(--text-tertiary)", letterSpacing: "-0.01em" }}
            >
              Loading...
            </span>
          </div>
        ) : activeTab === "inbox" ? (
          <InboxTab
            waitingItems={waitingItems}
            showAll={showAll}
            onToggleShowAll={toggleShowAll}
            view={inboxView}
            onSetView={setInboxView}
            filteredOut={inboxData?.filteredOut ?? 0}
            needsReplyCount={inboxData?.needsReplyCount ?? 0}
            onResolve={(itemId, channel) => resolveMutation.mutate({ itemId, channel })}
            onDismiss={(itemId, channel) => dismissMutation.mutate({ itemId, channel })}
            onSnooze={(itemId, hours, channel) =>
              snoozeMutation.mutate({ itemId, hours, channel })
            }
            onOverride={(itemId, needsResponse) =>
              overrideMutation.mutate({ itemId, needsResponse })
            }
            onBulkResolve={() => bulkResolveMutation.mutate()}
          />
        ) : activeTab === "groups" ? (
          <GroupsTab
            groupItems={groupChatItems}
            showAll={showAll}
            onToggleShowAll={toggleShowAll}
            onResolve={(itemId, channel) => resolveMutation.mutate({ itemId, channel })}
            onDismiss={(itemId, channel) => dismissMutation.mutate({ itemId, channel })}
            onSnooze={(itemId, hours, channel) =>
              snoozeMutation.mutate({ itemId, hours, channel })
            }
          />
        ) : (
          <ActivityTab items={activityItems} />
        )}
      </div>
      </PullToRefreshWrapper>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Needs-reply / All-inbound toggle (M0.x.2)
// ═══════════════════════════════════════════════════════════════

function NeedsReplyToggle({
  view,
  onSetView,
  filteredOut,
  needsReplyCount,
}: {
  view: "needs-reply" | "all";
  onSetView: (v: "needs-reply" | "all") => void;
  /** Items hidden by the Needs-reply filter — surfaced as "+N" on
   *  the All-inbound chip when Jennifer is on the Needs-reply view. */
  filteredOut: number;
  /** Items in the Needs-reply view — surfaced as "+N" on the
   *  Needs-reply chip when Jennifer is on the All-inbound view. */
  needsReplyCount: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <ToggleSegment
        active={view === "needs-reply"}
        onClick={() => onSetView("needs-reply")}
      >
        Needs reply
        {view === "all" && needsReplyCount > 0 ? (
          <CountChip>+{needsReplyCount}</CountChip>
        ) : null}
      </ToggleSegment>
      <ToggleSegment
        active={view === "all"}
        onClick={() => onSetView("all")}
      >
        All inbound
        {view === "needs-reply" && filteredOut > 0 ? (
          <CountChip>+{filteredOut}</CountChip>
        ) : null}
      </ToggleSegment>
    </div>
  );
}

function CountChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums"
      style={{ backgroundColor: "#EFEAE0", color: "#7A4F3C" }}
    >
      {children}
    </span>
  );
}

function ToggleSegment({
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

// ═══════════════════════════════════════════════════════════════
// INBOX TAB
// ═══════════════════════════════════════════════════════════════

function InboxTab({
  waitingItems,
  showAll,
  onToggleShowAll,
  view,
  onSetView,
  filteredOut,
  needsReplyCount,
  onResolve,
  onDismiss,
  onSnooze,
  onOverride,
  onBulkResolve,
}: {
  waitingItems: InboxItemData[];
  showAll: boolean;
  onToggleShowAll: () => void;
  view: "needs-reply" | "all";
  onSetView: (v: "needs-reply" | "all") => void;
  filteredOut: number;
  needsReplyCount: number;
  onResolve: (itemId: string, channel: string) => void;
  onDismiss: (itemId: string, channel: string) => void;
  onSnooze: (itemId: string, hours: number, channel: string) => void;
  onOverride: (itemId: string, needsResponse: boolean) => void;
  onBulkResolve: () => void;
}) {
  // Always show the view toggle if there are items either showing or
  // hidden behind the filter. Hiding the toggle when count=0 makes the
  // surface feel broken when the user flipped to "All" expecting more.
  const showToggle =
    waitingItems.length > 0 || filteredOut > 0 || needsReplyCount > 0;
  const toggle = showToggle ? (
    <NeedsReplyToggle
      view={view}
      onSetView={onSetView}
      filteredOut={filteredOut}
      needsReplyCount={needsReplyCount}
    />
  ) : null;

  if (waitingItems.length === 0) {
    return (
      <div className="space-y-4">
        {toggle}
        <div className="flex flex-col items-center py-12 text-center">
          <div
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--surface-sunken)" }}
          >
            <Check
              className="h-4 w-4"
              style={{ color: "var(--text-tertiary)" }}
            />
          </div>
          <p
            className="text-[14px] font-medium"
            style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}
          >
            Your inbox is clear
          </p>
          <p
            className="text-[12px] mt-1"
            style={{ color: "var(--text-tertiary)" }}
          >
            {view === "needs-reply"
              ? "Nothing here needs your reply"
              : "No messages need your attention"}
          </p>
        </div>
      </div>
    );
  }

  // Map items to have lastInboundAt for time grouping
  const itemsForGrouping = waitingItems.map((i) => ({
    ...i,
    lastInboundAt: i.triggerAt,
  }));
  const timeGroups = groupByTime(itemsForGrouping);
  const displayItems = showAll ? itemsForGrouping : itemsForGrouping.slice(0, 5);
  const displayGroups = showAll ? timeGroups : groupByTime(displayItems);

  return (
    <div className="space-y-4">
      {toggle}
      {/* Bulk "Clear all replied" — quiet moss chip, top-right of the
          waiting list. Bulk dismiss should not shout louder than the
          things being dismissed. */}
      {waitingItems.length >= 3 && (
        <div className="flex justify-end">
          <button
            onClick={onBulkResolve}
            className="inline-flex items-center gap-1.5 rounded-full pl-2 pr-3 py-1 text-[11.5px] font-medium transition-colors"
            style={{ backgroundColor: "#E4EBE3", color: "#6B8A6E" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#D6E2D5";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "#E4EBE3";
            }}
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#6B8A6E" }} />
            All replied · clear
          </button>
        </div>
      )}

      {/* Waiting on you — grouped by time */}
      <div>
        {displayGroups.map(({ group, items }) => (
          <div key={group}>
            <p
              className="text-[11px] font-semibold uppercase tracking-wider mb-2 mt-4 first:mt-0"
              style={{
                color: "var(--text-tertiary)",
                letterSpacing: "0.06em",
              }}
            >
              {group}
            </p>
            <div className="space-y-2">
              {items.map((item) => (
                <SwipeableRow
                  key={item.id}
                  onSwipeRight={() => onResolve(item.id, item.channel)}
                  onSwipeLeft={() => onDismiss(item.id, item.channel)}
                >
                  <InboxRow
                    item={item}
                    view={view}
                    onResolve={() => onResolve(item.id, item.channel)}
                    onDismiss={() => onDismiss(item.id, item.channel)}
                    onSnooze={(hours) => onSnooze(item.id, hours, item.channel)}
                    onOverride={(needsResponse) =>
                      onOverride(item.id, needsResponse)
                    }
                  />
                </SwipeableRow>
              ))}
            </div>
          </div>
        ))}

        {waitingItems.length > 5 && (
          <button
            onClick={onToggleShowAll}
            className="flex items-center gap-1 mt-3 w-full justify-center py-2 rounded-xl text-[12px] font-medium transition-colors"
            style={{
              color: "var(--text-tertiary)",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "";
            }}
          >
            <ChevronDown
              className="h-3 w-3 transition-transform"
              style={{
                transform: showAll ? "rotate(180deg)" : "rotate(0)",
              }}
            />
            {showAll ? "Show less" : `Show ${waitingItems.length - 5} more`}
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// GROUPS TAB
// ═══════════════════════════════════════════════════════════════

function GroupsTab({
  groupItems,
  showAll,
  onToggleShowAll,
  onResolve,
  onDismiss,
  onSnooze,
}: {
  groupItems: InboxItemData[];
  showAll: boolean;
  onToggleShowAll: () => void;
  onResolve: (itemId: string, channel: string) => void;
  onDismiss: (itemId: string, channel: string) => void;
  onSnooze: (itemId: string, hours: number, channel: string) => void;
}) {
  if (groupItems.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <div
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: "var(--surface-sunken)" }}
        >
          <MessageCircle
            className="h-4 w-4"
            style={{ color: "var(--text-tertiary)" }}
          />
        </div>
        <p
          className="text-[14px] font-medium"
          style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}
        >
          No active group chats
        </p>
        <p
          className="text-[12px] mt-1"
          style={{ color: "var(--text-tertiary)" }}
        >
          Group conversations from the last 7 days will appear here
        </p>
      </div>
    );
  }

  const itemsForGrouping = groupItems.map((i) => ({
    ...i,
    lastInboundAt: i.triggerAt,
  }));
  const timeGroups = groupByTime(itemsForGrouping);
  const displayItems = showAll ? itemsForGrouping : itemsForGrouping.slice(0, 5);
  const displayGroups = showAll ? timeGroups : groupByTime(displayItems);

  return (
    <div className="space-y-4">
      <p
        className="text-[12px]"
        style={{ color: "var(--text-tertiary)", letterSpacing: "-0.01em" }}
      >
        Group chats with recent inbound messages. Dismiss to hide.
      </p>

      <div>
        {displayGroups.map(({ group, items }) => (
          <div key={group}>
            <p
              className="text-[11px] font-semibold uppercase tracking-wider mb-2 mt-4 first:mt-0"
              style={{
                color: "var(--text-tertiary)",
                letterSpacing: "0.06em",
              }}
            >
              {group}
            </p>
            <div className="space-y-2">
              {items.map((item) => (
                <SwipeableRow
                  key={item.id}
                  onSwipeRight={() => onResolve(item.id, item.channel)}
                  onSwipeLeft={() => onDismiss(item.id, item.channel)}
                >
                  <GroupChatRow
                    item={item}
                    onResolve={() => onResolve(item.id, item.channel)}
                    onDismiss={() => onDismiss(item.id, item.channel)}
                    onSnooze={(hours) => onSnooze(item.id, hours, item.channel)}
                  />
                </SwipeableRow>
              ))}
            </div>
          </div>
        ))}

        {groupItems.length > 5 && (
          <button
            onClick={onToggleShowAll}
            className="flex items-center gap-1 mt-3 w-full justify-center py-2 rounded-xl text-[12px] font-medium transition-colors"
            style={{
              color: "var(--text-tertiary)",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "";
            }}
          >
            <ChevronDown
              className="h-3 w-3 transition-transform"
              style={{
                transform: showAll ? "rotate(180deg)" : "rotate(0)",
              }}
            />
            {showAll ? "Show less" : `Show ${groupItems.length - 5} more`}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Group Chat Row ─────────────────────────────────────────

function GroupChatRow({
  item,
  // onResolve omitted from destructure — the "Already replied" chip
  // that consumed it was removed in M0.5b. Prop kept on the type so
  // callers' shape doesn't change.
  onDismiss,
  onSnooze,
}: {
  item: InboxItemData;
  onResolve: () => void;
  onDismiss: () => void;
  onSnooze: (hours: number) => void;
}) {
  const [showSnooze, setShowSnooze] = useState(false);
  const color = getAvatarColor(item.contactName);

  const previews = (item.messagePreview ?? []) as MessagePreview[];
  const MAX_PREVIEWS = 5;
  const previewMessages = previews.slice(0, MAX_PREVIEWS);
  const extraCount = item.messageCount - MAX_PREVIEWS;

  return (
    <div
      className="group rounded-2xl p-4 transition-colors"
      style={{
        backgroundColor: "transparent",
        transitionDuration: "var(--duration-fast)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "#F5F6F8";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {/* Top row: avatar + name + time */}
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <Avatar className="h-9 w-9">
            <AvatarFallback
              className="text-[11px] font-semibold"
              style={{ backgroundColor: color.bg, color: color.text }}
            >
              {getInitials(item.contactName)}
            </AvatarFallback>
          </Avatar>
          <span
            className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
            style={{
              backgroundColor: "#FFFFFF",
              color: "var(--text-tertiary)",
              border: "1.5px solid var(--border, #E8E6E1)",
            }}
            title="Group chat"
          >
            G
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <span
            className="text-[15px] font-semibold truncate block"
            style={{ color: "#1A1A1A", letterSpacing: "-0.02em" }}
          >
            {item.contactName}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span style={{ color: item.hasDraft ? "#D97706" : "#B5BAC0" }}>
            <ChannelIcon channel={item.channel} size={13} />
          </span>
          {item.hasDraft && (
            <Pencil className="h-3 w-3" style={{ color: "#D97706" }} />
          )}
          <span
            className="text-[12px] tabular-nums"
            style={{ color: "#B5BAC0", letterSpacing: "-0.01em" }}
          >
            {formatDistanceToNow(new Date(item.triggerAt))}
          </span>
        </div>
      </div>

      {/* Draft indicator */}
      {item.hasDraft && (
        <div
          className="flex items-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-full text-[11px] font-medium w-fit"
          style={{ backgroundColor: "#EFEAE0", color: "#5A574F" }}
        >
          <Pencil className="h-3 w-3" strokeWidth={1.7} />
          Draft in progress
        </div>
      )}

      {/* Message previews */}
      {previewMessages.length > 0 && (
        <div
          className="mt-2.5 rounded-xl px-3.5 py-2.5 space-y-1.5"
          style={{
            backgroundColor: "#F5F6F8",
            borderLeft: "3px solid #E2E4E8",
          }}
        >
          {previewMessages.map((msg, i) => {
            const raw = msg.summary || "";
            const display = raw.replace("(in group chat) ", "");
            if (!display) return null;
            return (
              <p
                key={i}
                className="text-[13px]"
                style={{
                  color: i === 0 ? "#4A4E54" : "#7B8189",
                  letterSpacing: "-0.01em",
                  lineHeight: "1.5",
                }}
              >
                &ldquo;{truncateMessage(display)}&rdquo;
              </p>
            );
          })}
          {extraCount > 0 && (
            <p className="text-[11px]" style={{ color: "#B5BAC0" }}>
              +{extraCount} more message{extraCount !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      )}

      {/* "Already replied" manual chip was removed in M0.5b.
          onOutboundInteraction in lib/inbox.ts auto-resolves any
          OPEN item on the next Gmail sync once Jennifer sends a
          reply. Manual mark-as-replied is no longer needed; if the
          auto-resolve misses a case, that's a sync gap worth fixing
          rather than papering over with a user-visible button. */}

      {/* Actions: Dismiss + Snooze */}
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={onDismiss}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
          style={{
            border: "1px solid #E2E4E8",
            color: "#4A4E54",
            backgroundColor: "transparent",
            letterSpacing: "-0.01em",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "#F5F6F8";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <X className="h-3 w-3" />
          Dismiss
        </button>

        <div className="relative">
          <button
            onClick={() => setShowSnooze(!showSnooze)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              border: "1px solid #E2E4E8",
              color: "#4A4E54",
              backgroundColor: "transparent",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#F5F6F8";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <Bell className="h-3 w-3" />
            Snooze
          </button>
          {showSnooze && (
            <SnoozeDropdown
              onSelect={(hours) => {
                onSnooze(hours);
                setShowSnooze(false);
              }}
              onClose={() => setShowSnooze(false)}
            />
          )}
        </div>

        {item.messageCount > 1 && (
          <span
            className="ml-auto text-[11px]"
            style={{ color: "#B5BAC0" }}
          >
            {item.messageCount} messages
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Inbox Row ───────────────────────────────────────────────

function truncateMessage(text: string, maxLen = 80): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "...";
}

function InboxRow({
  item,
  view,
  // M0.9 restored: onResolve is the manual "Mark replied" escape
  // hatch. Auto-resolve handles most cases, but legitimately stale
  // items (cross-channel replies, sync lag) still need a way out.
  onResolve,
  onDismiss,
  onSnooze,
  onOverride,
}: {
  item: InboxItemData;
  view: "needs-reply" | "all";
  onResolve: () => void;
  onDismiss: () => void;
  onSnooze: (hours: number) => void;
  onOverride: (needsResponse: boolean) => void;
}) {
  const [showSnooze, setShowSnooze] = useState(false);
  const { openComposer } = useDraftComposer();
  const color = getAvatarColor(item.contactName);
  const replyUrl = getReplyUrl(item);

  const previews = (item.messagePreview ?? []) as MessagePreview[];
  const MAX_PREVIEWS = 10;
  const previewMessages = previews.slice(0, MAX_PREVIEWS);
  const extraCount = item.messageCount - MAX_PREVIEWS;

  // Compose a "Draft reply" — preloads the draft modal with
  // contactId + reply context. Only meaningful for email-shaped
  // channels; iMessage etc. fall back to the generic reply URL.
  const isEmailChannel =
    item.channel === "email" || item.channel === "gmail";
  function handleDraftReply() {
    openComposer({
      contactId: item.contactId,
      presetTone: "warm",
      presetContext: "reply_email",
      threadSubject: previews[0]?.summary?.slice(0, 140) ?? undefined,
      threadSnippet: previews[0]?.summary ?? undefined,
      // M0.x.4: pass threadKey so the generator can load the actual
      // inbound message body + thread history, not just the snippet.
      threadKey: item.threadKey,
    });
  }

  // Channel label
  const channelLabel =
    item.channel === "email" || item.channel === "gmail"
      ? "Email"
      : item.channel === "text" || item.channel === "iMessage" || item.channel === "SMS"
        ? "iMessage"
        : item.channel;

  const channelDotColor = CHANNEL_DOT_COLORS[item.channel] ?? "#B5BAC0";

  return (
    <div
      className="group rounded-2xl p-4 sm:p-4 transition-colors"
      style={{
        backgroundColor: "transparent",
        transitionDuration: "var(--duration-fast)",
        minHeight: 44,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "#F5F6F8";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {/* Top row: avatar + name + channel + time */}
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <Avatar className="h-9 w-9 sm:h-9 sm:w-9">
            <AvatarFallback
              className="text-[11px] font-semibold"
              style={{ backgroundColor: color.bg, color: color.text }}
            >
              {getInitials(item.contactName)}
            </AvatarFallback>
          </Avatar>
          {item.isGroupChat && (
            <span
              className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
              style={{
                backgroundColor: "#FFFFFF",
                color: "var(--text-tertiary)",
                border: "1.5px solid var(--border, #E8E6E1)",
              }}
              title="Group chat"
            >
              G
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-[15px] font-semibold truncate"
              style={{ color: "#1A1A1A", letterSpacing: "-0.02em" }}
            >
              {item.contactName}
            </span>
            {item.company && (
              <span
                className="text-[12px] truncate hidden sm:inline max-w-[120px]"
                style={{ color: "#7B8189" }}
              >
                {item.company}
              </span>
            )}
            {item.hasDraft ? (
              <span
                className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full hidden sm:inline-flex"
                style={{
                  backgroundColor: "#EFEAE0",
                  color: "#5A574F",
                  letterSpacing: "-0.01em",
                }}
              >
                <Pencil className="h-2.5 w-2.5" strokeWidth={1.7} />
                Draft in progress
              </span>
            ) : item.priorityReason ? (
              <span
                className="inline-flex items-center gap-1 hidden sm:inline-flex"
              >
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                  style={{
                    // Earth-palette whispers. High = deepest sand-brown
                    // (still readable as "warmer than the rest" without
                    // tipping into pink/coral). Medium = neutral sand.
                    // Low = ghost. The chip should never out-shout the
                    // message content.
                    backgroundColor: item.priority === "high"
                      ? "#F0E5DC"
                      : item.priority === "medium"
                        ? "#EFEAE0"
                        : "transparent",
                    color: item.priority === "high"
                      ? "#7A4F3C"
                      : item.priority === "medium"
                        ? "#5A574F"
                        : "#8C8A82",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {item.priorityReason}
                </span>
                <EvidenceChevron
                  reason={item.priorityReason}
                  sourceSystem={item.sourceSystem ?? null}
                  sourceRecordIds={item.sourceRecordIds ?? []}
                  compact
                />
              </span>
            ) : null}
          </div>
          {/* Mobile: timestamp + channel dot below name */}
          <div className="flex items-center gap-1.5 sm:hidden mt-0.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: channelDotColor }}
            />
            <span
              className="text-[11px] tabular-nums"
              style={{ color: "#B5BAC0" }}
            >
              {formatDistanceToNow(new Date(item.triggerAt))}
            </span>
            {item.priorityReason && (
              <span
                className="text-[10px]"
                style={{
                  color: item.priority === "high"
                    ? "#DC2626"
                    : item.priority === "medium"
                      ? "#D97706"
                      : "#9CA3AF",
                }}
              >
                &middot; {item.priorityReason}
              </span>
            )}
          </div>
        </div>

        {/* Channel + time — desktop only */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          <span style={{ color: item.hasDraft ? "#D97706" : "#B5BAC0" }}>
            <ChannelIcon channel={item.channel} size={13} />
          </span>
          {item.hasDraft && (
            <Pencil className="h-3 w-3" style={{ color: "#D97706" }} />
          )}
          <span
            className="text-[12px] tabular-nums"
            style={{ color: "#B5BAC0", letterSpacing: "-0.01em" }}
          >
            {formatDistanceToNow(new Date(item.triggerAt))}
          </span>
        </div>
      </div>

      {/* Classifier subtitle — quiet single line beneath the header.
          M0.x.2: the reason is the model's short framing
          ("Asks a direct question"); when the user toggled into "All"
          and the model said this item doesn't need a reply we show
          that explicitly so the de-prioritization is legible.        */}
      {item.responseReason && (
        <p
          className="text-[11.5px] mt-0.5 ml-12"
          style={{
            color:
              item.needsResponse === false
                ? "#A6968B"
                : "var(--text-tertiary)",
            letterSpacing: "-0.01em",
          }}
        >
          {item.needsResponse === false
            ? `Marked as no reply needed · ${trimToShortPhrase(item.responseReason)}`
            : trimToShortPhrase(item.responseReason)}
        </p>
      )}

      {/* Message previews */}
      {previewMessages.length > 0 && (
        <div
          className="mt-2.5 rounded-xl px-3.5 py-2.5 space-y-1.5"
          style={{
            backgroundColor: "#F5F6F8",
            borderLeft: "3px solid #E2E4E8",
          }}
        >
          {previewMessages.map((msg, i) => {
            const raw = msg.summary || "";
            const isMsgGroupChat = raw.startsWith("(in group chat)");
            const display = isMsgGroupChat
              ? raw.replace("(in group chat) ", "")
              : raw;
            if (!display) return null;
            return (
              <p
                key={i}
                className="text-[13px]"
                style={{
                  color: i === 0 ? "#4A4E54" : "#7B8189",
                  letterSpacing: "-0.01em",
                  lineHeight: "1.5",
                }}
              >
                {item.isGroupChat && i === 0 && (
                  <span
                    className="text-[11px] font-medium mr-1.5 px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: "#E8EAEE", color: "#6B7280" }}
                  >
                    {item.threadKey && item.threadKey !== "group" ? item.threadKey : "GC"}
                  </span>
                )}
                &ldquo;{truncateMessage(display)}&rdquo;
              </p>
            );
          })}
          {extraCount > 0 && (
            <p className="text-[11px]" style={{ color: "#B5BAC0" }}>
              +{extraCount} more message{extraCount !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      )}

      {/* "Already replied" manual chip removed (M0.5b). Auto-resolve
          via onOutboundInteraction handles it on the next sync. */}

      {/* Meta + Actions — actions appear on hover (or focus) on desktop;
          always visible on touch so they remain reachable without hover. */}
      <div
        className="flex items-center gap-2 mt-2 transition-opacity opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
        style={{ transitionDuration: "180ms" }}
      >
        {replyUrl ? (
          <a
            href={replyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-full px-3 py-2 sm:py-1.5 text-[12px] font-medium transition-colors"
            style={{
              backgroundColor: "var(--accent-color)",
              color: "var(--text-inverse)",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--accent-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--accent-color)";
            }}
            onClick={(e) => e.stopPropagation()}
          >
            Reply
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <a
            href={`/people?contact=${item.contactId}`}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              backgroundColor: "var(--accent-color)",
              color: "var(--text-inverse)",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--accent-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--accent-color)";
            }}
          >
            View contact
            <ArrowUpRight className="h-3 w-3" />
          </a>
        )}

        {/* Snooze */}
        <div className="relative">
          <button
            onClick={() => setShowSnooze(!showSnooze)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              backgroundColor: "transparent",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--accent-soft)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <Bell className="h-3 w-3" />
            Snooze
          </button>
          {showSnooze && (
            <SnoozeDropdown
              onSelect={(hours) => {
                onSnooze(hours);
                setShowSnooze(false);
              }}
              onClose={() => setShowSnooze(false)}
            />
          )}
        </div>

        {/* Mark replied — manual resolve escape hatch (M0.9). Auto-
            resolve handles the canonical case; this covers cross-
            channel replies, sync lag, and items the user wants gone. */}
        <button
          onClick={onResolve}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
          style={{
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            backgroundColor: "transparent",
            letterSpacing: "-0.01em",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--accent-soft)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <Check className="h-3 w-3" />
          Mark replied
        </button>

        {/* Draft reply — opens the composer pre-loaded with this
            contact + reply_email context. Email channels only;
            non-email channels lean on the existing reply URL above. */}
        {isEmailChannel && (
          <button
            onClick={handleDraftReply}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              backgroundColor: "transparent",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--accent-soft)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <Pencil className="h-3 w-3" />
            Draft reply
          </button>
        )}

        {/* Classifier override (M0.x.2). In Needs-reply view this
            says "Doesn't need a reply" and removes the row; in All
            view (where the row is visible regardless), if the
            classifier already marked it false, this becomes "Move
            back to Needs reply" to flip the decision back. */}
        {item.needsResponse !== false ? (
          <button
            onClick={() => onOverride(false)}
            title="Mark this as something you don't need to reply to"
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text-tertiary)",
              backgroundColor: "transparent",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--accent-soft)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            Doesn&rsquo;t need a reply
          </button>
        ) : view === "all" ? (
          <button
            onClick={() => onOverride(true)}
            title="Restore to the Needs-reply view"
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text-tertiary)",
              backgroundColor: "transparent",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--accent-soft)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            Move back to Needs reply
          </button>
        ) : null}

        {/* Dismiss for group chats */}
        {item.isGroupChat && (
          <button
            onClick={onDismiss}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              backgroundColor: "transparent",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--accent-soft)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <X className="h-3 w-3" />
            Dismiss
          </button>
        )}

        {/* Message count + channel */}
        {item.messageCount > 1 && (
          <span
            className="ml-auto text-[11px]"
            style={{ color: "#B5BAC0" }}
          >
            {item.messageCount} messages &middot; {channelLabel}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Pull-to-refresh wrapper ────────────────────────────────

function PullToRefreshWrapper({
  children,
  onRefresh,
}: {
  children: React.ReactNode;
  onRefresh: () => Promise<void>;
}) {
  const { containerRef, pullDistance, refreshing, onTouchStart, onTouchMove, onTouchEnd } =
    usePullToRefresh(onRefresh);

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ position: "relative", overflowY: "auto" }}
    >
      {/* Pull indicator */}
      {(pullDistance > 0 || refreshing) && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: refreshing ? 40 : pullDistance,
            overflow: "hidden",
            transition: pullDistance === 0 ? "height 0.2s ease-out" : "none",
          }}
        >
          <Loader2
            className="h-4 w-4"
            style={{
              color: "var(--text-tertiary)",
              animation: refreshing ? "spin 1s linear infinite" : "none",
              opacity: Math.min(pullDistance / 50, 1),
            }}
          />
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Swipeable Row Wrapper ──────────────────────────────────

function SwipeableRow({
  children,
  onSwipeRight,
  onSwipeLeft,
}: {
  children: React.ReactNode;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
}) {
  const { offset, onTouchStart, onTouchMove, onTouchEnd } = useSwipe(
    onSwipeRight,
    onSwipeLeft,
  );

  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 16 }}>
      {/* Background indicators */}
      {offset !== 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: offset > 0 ? "flex-start" : "flex-end",
            padding: "0 24px",
            backgroundColor: offset > 0 ? "rgba(5,150,105,0.12)" : "rgba(107,114,128,0.08)",
            transition: "none",
          }}
        >
          {offset > 0 ? (
            <Check className="h-5 w-5" style={{ color: "#059669" }} />
          ) : (
            <X className="h-5 w-5" style={{ color: "#6B7280" }} />
          )}
        </div>
      )}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: `translateX(${offset}px)`,
          transition: offset === 0 ? "transform 0.2s ease-out" : "none",
          position: "relative",
          zIndex: 1,
          backgroundColor: "#FFFFFF",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Snooze Dropdown ─────────────────────────────────────────

function SnoozeDropdown({
  onSelect,
  onClose,
}: {
  onSelect: (hours: number) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute left-0 top-full mt-1 z-50 min-w-[140px] rounded-xl py-1"
        style={{
          backgroundColor: "#fff",
          border: "1px solid #E2E4E8",
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
        }}
        role="menu"
      >
        {SNOOZE_OPTIONS.map((opt) => (
          <button
            key={opt.hours}
            role="menuitem"
            onClick={() => onSelect(opt.hours)}
            className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium text-left transition-colors"
            style={{ color: "#4A4E54", letterSpacing: "-0.01em" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#F5F6F8";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "";
            }}
          >
            <Clock className="h-3 w-3 shrink-0" style={{ color: "#B5BAC0" }} />
            {opt.label}
          </button>
        ))}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// ACTION ITEMS CARD (standalone, separate from inbox)
// ═══════════════════════════════════════════════════════════════

export function ActionItemsCard() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ items: MessageActionItem[] }>({
    queryKey: ["message-actions"],
    queryFn: async () => {
      const res = await fetch("/api/message-actions");
      if (!res.ok) return { items: [] };
      return res.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async (args: { id: string; status: "DONE" | "DISMISSED" }) => {
      const res = await fetch("/api/message-actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["message-actions"] });
    },
  });

  const items = data?.items ?? [];

  if (!isLoading && items.length === 0) return null;

  return (
    <div
      className="crm-card overflow-hidden"
      style={{ backgroundColor: "#F1ECDE" }}
    >
      <div className="px-6 pt-5 pb-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3
              className="text-[15px] font-semibold"
              style={{ color: "var(--text-primary)", letterSpacing: "-0.02em" }}
            >
              Action items
            </h3>
            {items.length > 0 && (
              <span
                className="rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-none"
                style={{
                  backgroundColor: "rgba(220,38,38,0.08)",
                  color: "#DC2626",
                }}
              >
                {items.length}
              </span>
            )}
          </div>
          <span
            className="text-[11px]"
            style={{ color: "var(--text-tertiary)", letterSpacing: "-0.01em" }}
          >
            Things you need to do
          </span>
        </div>
      </div>
      <div className="px-6 pt-3 pb-5">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8">
            <Loader2
              className="h-4 w-4 animate-spin"
              style={{ color: "var(--text-tertiary)" }}
            />
            <span
              className="text-[13px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              Loading...
            </span>
          </div>
        ) : (
          <div className="space-y-1">
            {items.map((item) => (
              <ActionItemRow
                key={item.id}
                item={item}
                onDone={() => mutation.mutate({ id: item.id, status: "DONE" })}
                onDismiss={() =>
                  mutation.mutate({ id: item.id, status: "DISMISSED" })
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Action Item Row ─────────────────────────────────────────

function ActionItemRow({
  item,
  onDone,
  onDismiss,
}: {
  item: MessageActionItem;
  onDone: () => void;
  onDismiss: () => void;
}) {
  const urgColors = urgencyColors[item.urgency] ?? urgencyColors.medium;
  const isInvitation = item.classification === "invitation";

  return (
    <div
      className="group flex items-start gap-3 rounded-xl px-3 py-3 transition-colors"
      style={{ transitionDuration: "var(--duration-fast)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "#F5F6F8";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "";
      }}
    >
      {/* Checkbox */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDone();
        }}
        className="shrink-0 mt-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border-[1.5px] transition-colors"
        style={{
          borderColor: "#D1D5DB",
          backgroundColor: "transparent",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "#059669";
          e.currentTarget.style.backgroundColor = "rgba(5,150,105,0.06)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "#D1D5DB";
          e.currentTarget.style.backgroundColor = "transparent";
        }}
        title="Mark done"
      >
        <Check
          className="h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity"
          style={{ color: "#059669" }}
        />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p
            className="text-[13px] font-medium truncate"
            style={{ color: "#1A1A1A", letterSpacing: "-0.01em" }}
          >
            {item.title}
          </p>
          <span
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: urgColors.bg, color: urgColors.text }}
          >
            {item.urgency}
          </span>
          {isInvitation && (
            <span
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor: "rgba(124,58,237,0.08)",
                color: "#7C3AED",
              }}
            >
              Invitation
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          {item.contactName && (
            <span className="text-[12px] font-medium" style={{ color: "#4A4E54" }}>
              {item.contactName}
            </span>
          )}
          {item.preview && (
            <span
              className="text-[12px] truncate"
              style={{ color: "#9BA1A8", letterSpacing: "-0.01em" }}
            >
              &middot; &ldquo;{truncateMessage(item.preview, 80)}&rdquo;
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {item.occurredAt && (
            <span className="text-[11px]" style={{ color: "#B5BAC0" }}>
              {formatDistanceToNow(new Date(item.occurredAt))}
            </span>
          )}
          {item.channel && (
            <span className="flex items-center gap-1" style={{ color: "#B5BAC0" }}>
              <span className="text-[11px]">&middot;</span>
              <ChannelIcon channel={item.channel} size={11} />
            </span>
          )}
        </div>
      </div>

      {/* Dismiss button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="shrink-0 mt-0.5 rounded-lg p-1.5 opacity-0 group-hover:opacity-100 transition-all"
        style={{ color: "#B5BAC0" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "#F5F6F8";
          e.currentTarget.style.color = "#1A1A1A";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "";
          e.currentTarget.style.color = "#B5BAC0";
        }}
        title="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ACTIVITY TAB
// ═══════════════════════════════════════════════════════════════

function ActivityTab({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <p
          className="text-[14px] font-medium"
          style={{ color: "#1A1A1A", letterSpacing: "-0.01em" }}
        >
          No recent history
        </p>
        <p className="text-[12px] mt-1" style={{ color: "#7B8189" }}>
          Interactions will show up here as they happen
        </p>
      </div>
    );
  }

  const timeGroups = groupByTime(items);

  return (
    <div>
      {timeGroups.map(({ group, items: groupItems }) => (
        <div key={group}>
          <p
            className="text-[11px] font-semibold uppercase tracking-wider mb-3 mt-5 first:mt-0"
            style={{ color: "#7B8189", letterSpacing: "0.06em" }}
          >
            {group}
          </p>

          {/* Timeline */}
          <div className="relative">
            {/* Vertical line */}
            <div
              className="absolute left-[7px] top-3 bottom-3 w-px"
              style={{ backgroundColor: "#E2E4E8" }}
            />

            <div className="space-y-0">
              {groupItems.map((item) => (
                <TimelineEntry key={item.id} item={item} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Timeline Entry ──────────────────────────────────────────

function TimelineEntry({ item }: { item: ActivityItem }) {
  const isOutbound = item.direction === "OUTBOUND";
  const channelColor =
    CHANNEL_DOT_COLORS[item.channel ?? ""] ?? "#B5BAC0";
  const preview =
    item.summary?.slice(0, 120) ??
    item.subject ??
    item.type.toLowerCase();

  const time = new Date(item.occurredAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <div
      className="group relative flex items-start gap-3 py-2 rounded-xl transition-colors cursor-default"
      style={{ transitionDuration: "var(--duration-fast)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "#F5F6F8";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "";
      }}
    >
      {/* Timeline dot */}
      <div
        className="relative z-10 mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-[2.5px]"
        style={{
          borderColor: channelColor,
          backgroundColor: "#FFFFFF",
        }}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {/* Direction arrow */}
          {isOutbound ? (
            <ArrowUpRight
              className="h-3 w-3 shrink-0"
              style={{ color: "#059669" }}
            />
          ) : (
            <ArrowDownLeft
              className="h-3 w-3 shrink-0"
              style={{ color: "#3B82F6" }}
            />
          )}

          <span
            className="text-[13px] font-medium"
            style={{ color: "#1A1A1A", letterSpacing: "-0.01em" }}
          >
            {isOutbound ? "You" : item.contactName}
          </span>
          <span className="text-[12px]" style={{ color: "#B5BAC0" }}>
            →
          </span>
          <span
            className="text-[13px] font-medium truncate"
            style={{ color: "#1A1A1A", letterSpacing: "-0.01em" }}
          >
            {isOutbound ? item.contactName : "You"}
          </span>

          {/* Channel icon */}
          <span style={{ color: "#B5BAC0" }}>
            <ChannelIcon channel={item.channel ?? "unknown"} size={12} />
          </span>
        </div>

        {/* Preview */}
        <p
          className="text-[13px] mt-0.5 truncate"
          style={{
            color: "#4A4E54",
            letterSpacing: "-0.01em",
            paddingLeft: isOutbound ? 20 : 0,
          }}
        >
          {preview}
        </p>
      </div>

      {/* Time */}
      <span
        className="shrink-0 text-[11px] mt-0.5 tabular-nums"
        style={{ color: "#B5BAC0", letterSpacing: "-0.01em" }}
      >
        {time}
      </span>
    </div>
  );
}
