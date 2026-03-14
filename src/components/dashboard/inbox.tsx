"use client";

import { useState } from "react";
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
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { formatDistanceToNow } from "@/lib/date-utils";

// ─── Types ───────────────────────────────────────────────────

interface InboundMessage {
  summary: string;
  subject: string | null;
  occurredAt: string;
}

interface NeedsResponseItem {
  contactId: string;
  contactName: string;
  company: string | null;
  tier: string;
  channel: string;
  lastInboundSubject: string | null;
  messages: InboundMessage[];
  messageCount: number;
  lastInboundAt: string;
  waitingHours: number;
  urgency: "high" | "medium" | "low";
  urgencyScore: number;
  confidence: "certain" | "likely" | "possible";
  circles: string[];
  contactEmail: string | null;
  contactPhone: string | null;
  contactLinkedinUrl: string | null;
}

interface NeedsResponseData {
  items: NeedsResponseItem[];
  totalWaiting: number;
  scannedContacts: number;
  channelCoverage: Record<string, { inbound: boolean; outbound: boolean }>;
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
  iMessage: "#34C759",
  SMS: "#34C759",
  gmail: "#EA4335",
  email: "#EA4335",
  linkedin: "#0A66C2",
  calendar: "#7C3AED",
};

function getReplyUrl(item: NeedsResponseItem): string | null {
  const ch = item.channel;
  if ((ch === "iMessage" || ch === "SMS") && item.contactPhone) {
    return `sms:${item.contactPhone}`;
  }
  if ((ch === "gmail" || ch === "email") && item.contactEmail) {
    const subject = item.lastInboundSubject
      ? `Re: ${item.lastInboundSubject}`
      : "";
    return `mailto:${item.contactEmail}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
  }
  if (ch === "linkedin" && item.contactLinkedinUrl) {
    return item.contactLinkedinUrl;
  }
  return null;
}

// ─── Time grouping ───────────────────────────────────────────

type TimeGroup = "Now" | "Today" | "Yesterday" | "This week" | "Older";

function getTimeGroup(isoDate: string): TimeGroup {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 1) return "Now";

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
  const order: TimeGroup[] = ["Now", "Today", "Yesterday", "This week", "Older"];
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
  const [activeTab, setActiveTab] = useState<"inbox" | "activity">("inbox");
  const [showAll, setShowAll] = useState(false);

  // ─── Data fetching ──────────────────────────────────────────

  const { data: needsResponse, isLoading: loadingNR } =
    useQuery<NeedsResponseData>({
      queryKey: ["needs-response"],
      queryFn: async () => {
        const res = await fetch("/api/needs-response");
        if (!res.ok)
          return { items: [], totalWaiting: 0, scannedContacts: 0, channelCoverage: {} };
        return res.json();
      },
      refetchInterval: 5 * 60 * 1000,
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
    enabled: activeTab === "activity",
  });

  // ─── Mutations ──────────────────────────────────────────────

  const syncMutation = useMutation({
    mutationFn: async () => {
      await Promise.all([
        fetch("/api/notion-messages", { method: "POST" }),
        fetch("/api/imessage", { method: "POST" }),
        fetch("/api/gmail/sync", { method: "POST" }),
      ]);
      // Scan for action items from both iMessage interactions and email threads
      await Promise.all([
        fetch("/api/message-actions", { method: "POST" }),
        fetch("/api/gmail/extract-actions", { method: "POST" }),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["needs-response"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["message-actions"] });
      toast("Synced and scanned for new items");
    },
    onError: () => toast.error("Sync failed"),
  });

  const repliedMutation = useMutation({
    mutationFn: async (args: { contactId: string; channel: string }) => {
      const res = await fetch(
        `/api/needs-response/${args.contactId}/replied`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: args.channel }),
        },
      );
      if (!res.ok) throw new Error("Failed");
    },
    onMutate: async ({ contactId, channel }) => {
      // Optimistic: remove from list immediately
      await queryClient.cancelQueries({ queryKey: ["needs-response"] });
      const prev = queryClient.getQueryData<NeedsResponseData>(["needs-response"]);
      if (prev) {
        queryClient.setQueryData<NeedsResponseData>(["needs-response"], {
          ...prev,
          items: prev.items.filter(
            (i) => !(i.contactId === contactId && i.channel === channel),
          ),
          totalWaiting: prev.totalWaiting - 1,
        });
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(["needs-response"], context.prev);
      }
      toast.error("Failed to mark as replied");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["needs-response"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const snoozeMutation = useMutation({
    mutationFn: async (args: { contactId: string; hours: number }) => {
      const res = await fetch(
        `/api/needs-response/${args.contactId}/snooze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hours: args.hours }),
        },
      );
      if (!res.ok) throw new Error("Failed");
    },
    onMutate: async ({ contactId }) => {
      await queryClient.cancelQueries({ queryKey: ["needs-response"] });
      const prev = queryClient.getQueryData<NeedsResponseData>(["needs-response"]);
      if (prev) {
        queryClient.setQueryData<NeedsResponseData>(["needs-response"], {
          ...prev,
          items: prev.items.filter((i) => i.contactId !== contactId),
          totalWaiting: prev.totalWaiting - 1,
        });
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(["needs-response"], context.prev);
      }
      toast.error("Failed to snooze");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["needs-response"] });
    },
  });

  // ─── Derived data ───────────────────────────────────────────

  const waitingItems = needsResponse?.items ?? [];
  const activityItems = activityData?.items ?? [];
  const inboxCount = waitingItems.length;
  const isLoading =
    activeTab === "inbox"
      ? loadingNR
      : loadingActivity;

  return (
    <div className="crm-card overflow-hidden">
      {/* ─── Tab bar ────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-6 pt-5 pb-0"
      >
        <div
          className="flex items-center gap-1 rounded-xl p-1"
          style={{ backgroundColor: "var(--surface-sunken)" }}
        >
          <button
            onClick={() => setActiveTab("inbox")}
            className="relative flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all"
            style={{
              backgroundColor:
                activeTab === "inbox" ? "var(--surface, #fff)" : "transparent",
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
                className="rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-none"
                style={{
                  backgroundColor:
                    activeTab === "inbox"
                      ? "var(--status-urgent, #DC2626)"
                      : "var(--text-tertiary)",
                  color: "#fff",
                }}
              >
                {inboxCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("activity")}
            className="rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all"
            style={{
              backgroundColor:
                activeTab === "activity"
                  ? "var(--surface, #fff)"
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
            Activity
          </button>
        </div>

        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
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
          {syncMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {syncMutation.isPending ? "Syncing..." : "Sync & scan"}
        </button>
      </div>

      {/* ─── Tab content ────────────────────────────────────── */}
      <div className="px-6 pt-4 pb-5">
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
            onToggleShowAll={() => setShowAll(!showAll)}
            onMarkReplied={(contactId, channel) =>
              repliedMutation.mutate({ contactId, channel })
            }
            onSnooze={(contactId, hours) =>
              snoozeMutation.mutate({ contactId, hours })
            }
          />
        ) : (
          <ActivityTab items={activityItems} />
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// INBOX TAB
// ═══════════════════════════════════════════════════════════════

function InboxTab({
  waitingItems,
  showAll,
  onToggleShowAll,
  onMarkReplied,
  onSnooze,
}: {
  waitingItems: NeedsResponseItem[];
  showAll: boolean;
  onToggleShowAll: () => void;
  onMarkReplied: (contactId: string, channel: string) => void;
  onSnooze: (contactId: string, hours: number) => void;
}) {
  if (waitingItems.length === 0) {
    return (
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
          No messages need your attention
        </p>
      </div>
    );
  }

  const timeGroups = groupByTime(waitingItems);
  const displayItems = showAll ? waitingItems : waitingItems.slice(0, 5);
  const displayGroups = showAll ? timeGroups : groupByTime(displayItems);

  return (
    <div className="space-y-6">
      {/* Waiting on you — grouped by time */}
      {waitingItems.length > 0 && (
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
                  <InboxRow
                    key={`${item.contactId}-${item.channel}`}
                    item={item}
                    onMarkReplied={() =>
                      onMarkReplied(item.contactId, item.channel)
                    }
                    onSnooze={(hours) => onSnooze(item.contactId, hours)}
                  />
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
      )}

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
  onMarkReplied,
  onSnooze,
}: {
  item: NeedsResponseItem;
  onMarkReplied: () => void;
  onSnooze: (hours: number) => void;
}) {
  const [showSnooze, setShowSnooze] = useState(false);
  const color = getAvatarColor(item.contactName);
  const replyUrl = getReplyUrl(item);
  const isOverdue = item.urgency === "high";

  // Show up to 3 messages, newest first
  const MAX_PREVIEWS = 3;
  const previewMessages = item.messages.slice(0, MAX_PREVIEWS);
  const extraCount = item.messageCount - MAX_PREVIEWS;
  const hasSubject = !!item.lastInboundSubject;

  // Channel label
  const channelLabel =
    item.channel === "gmail" || item.channel === "email"
      ? "Email"
      : item.channel;

  return (
    <div
      className="group rounded-2xl p-4 transition-colors"
      style={{
        backgroundColor: isOverdue
          ? "rgba(220,38,38,0.03)"
          : "transparent",
        transitionDuration: "var(--duration-fast)",
      }}
      onMouseEnter={(e) => {
        if (!isOverdue) e.currentTarget.style.backgroundColor = "#F5F6F8";
      }}
      onMouseLeave={(e) => {
        if (!isOverdue) e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {/* Top row: avatar + name + channel + time */}
      <div className="flex items-center gap-3">
        {/* Avatar with confidence badge */}
        <div className="relative shrink-0">
          <Avatar className="h-9 w-9">
            <AvatarFallback
              className="text-[11px] font-semibold"
              style={{ backgroundColor: color.bg, color: color.text }}
            >
              {getInitials(item.contactName)}
            </AvatarFallback>
          </Avatar>
          {item.confidence === "possible" && (
            <span
              className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
              style={{
                backgroundColor: "var(--surface, #fff)",
                color: "var(--text-tertiary)",
                border: "1.5px solid var(--border, #E8E6E1)",
              }}
              title="We can't confirm whether you've replied on this channel"
            >
              ?
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
                className="text-[12px] truncate hidden sm:inline"
                style={{ color: "#7B8189" }}
              >
                {item.company}
              </span>
            )}
          </div>
        </div>

        {/* Channel + time */}
        <div className="flex items-center gap-2 shrink-0">
          <span style={{ color: "#B5BAC0" }}>
            <ChannelIcon channel={item.channel} size={13} />
          </span>
          <span
            className="text-[12px] tabular-nums"
            style={{ color: "#B5BAC0", letterSpacing: "-0.01em" }}
          >
            {formatDistanceToNow(new Date(item.lastInboundAt))}
          </span>
        </div>
      </div>

      {/* Message previews — quoted style */}
      {previewMessages.length > 0 && (
        <div
          className="mt-2.5 rounded-xl px-3.5 py-2.5 space-y-1.5"
          style={{
            backgroundColor: "#F5F6F8",
            borderLeft: `3px solid ${
              isOverdue
                ? "#DC2626"
                : item.urgency === "medium"
                  ? "#D97706"
                  : "#E2E4E8"
            }`,
          }}
        >
          {hasSubject && (
            <p
              className="text-[13px] font-medium line-clamp-1"
              style={{ color: "#1A1A1A", letterSpacing: "-0.01em" }}
            >
              {item.lastInboundSubject}
            </p>
          )}
          {previewMessages.map((msg, i) => {
            const raw = msg.summary || "";
            const isGroupChat = raw.startsWith("(in group chat)");
            const display = isGroupChat
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
                &ldquo;{truncateMessage(display)}&rdquo;
              </p>
            );
          })}
          {extraCount > 0 && (
            <p
              className="text-[11px]"
              style={{ color: "#B5BAC0" }}
            >
              +{extraCount} more message{extraCount !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      )}

      {/* Meta + Actions */}
      <div className="flex items-center gap-2 mt-3">
        {replyUrl && (
          <a
            href={replyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              backgroundColor: "#1A1A1A",
              color: "#fff",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#333";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "#1A1A1A";
            }}
            onClick={(e) => e.stopPropagation()}
          >
            Reply
            <ExternalLink className="h-3 w-3" />
          </a>
        )}

        {/* Snooze */}
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

        {/* Mark as replied */}
        <button
          onClick={onMarkReplied}
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
          <Check className="h-3 w-3" />
          Mark as replied
        </button>

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
    <div className="crm-card overflow-hidden">
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
          No recent activity
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
          backgroundColor: "var(--surface, #fff)",
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
