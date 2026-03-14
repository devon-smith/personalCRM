"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Inbox,
  Mail,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  X,
  Check,
  Loader2,
  Copy,
  FileEdit,
  Linkedin,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "@/lib/date-utils";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { useDraftComposer } from "@/lib/draft-composer-context";
import Link from "next/link";

/** Decode HTML entities that Gmail API embeds in snippets. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ─── Types matching the actual API response ─────────────────

interface InboundMessage {
  readonly summary: string;
  readonly subject: string | null;
  readonly occurredAt: string;
}

interface NeedsResponseItem {
  readonly contactId: string;
  readonly contactName: string;
  readonly company: string | null;
  readonly tier: string;
  readonly channel: string;
  readonly lastInboundSubject: string | null;
  readonly messages: readonly InboundMessage[];
  readonly messageCount: number;
  readonly lastInboundAt: string;
  readonly waitingHours: number;
  readonly urgency: "high" | "medium" | "low";
  readonly urgencyScore: number;
  readonly confidence: "certain" | "likely" | "possible";
  readonly circles: readonly string[];
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly contactLinkedinUrl: string | null;
}

interface NeedsResponseData {
  readonly items: NeedsResponseItem[];
  readonly totalWaiting: number;
  readonly scannedContacts: number;
  readonly channelCoverage: Record<string, { inbound: boolean; outbound: boolean }>;
}

type ChannelFilter = "all" | "email" | "imessage";

const PRIORITY_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  high: {
    bg: "var(--status-urgent-bg)",
    text: "var(--status-urgent)",
    dot: "var(--status-urgent)",
  },
  medium: {
    bg: "var(--status-warning-bg, rgba(245, 158, 11, 0.1))",
    text: "var(--status-warning, #f59e0b)",
    dot: "var(--status-warning, #f59e0b)",
  },
  low: {
    bg: "var(--surface-sunken)",
    text: "var(--text-tertiary)",
    dot: "var(--border-strong)",
  },
};

function getChannelGroup(channel: string): "email" | "imessage" | "other" {
  if (channel === "gmail" || channel === "email") return "email";
  if (channel === "iMessage" || channel === "SMS") return "imessage";
  return "other";
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "gmail" || channel === "email") return <Mail className="h-3 w-3 shrink-0" style={{ color: "var(--text-tertiary)" }} />;
  if (channel === "linkedin") return <Linkedin className="h-3 w-3 shrink-0" style={{ color: "var(--text-tertiary)" }} />;
  return <MessageSquare className="h-3 w-3 shrink-0" style={{ color: "var(--text-tertiary)" }} />;
}

function channelLabel(channel: string): string {
  if (channel === "gmail" || channel === "email") return "Email";
  if (channel === "iMessage" || channel === "SMS") return "iMessage";
  if (channel === "linkedin") return "LinkedIn";
  return channel;
}

export function NeedsResponse() {
  const queryClient = useQueryClient();
  const { openComposer } = useDraftComposer();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const { data, isLoading } = useQuery<NeedsResponseData>({
    queryKey: ["needs-response"],
    queryFn: async () => {
      const res = await fetch("/api/needs-response");
      if (!res.ok) throw new Error("Failed to scan");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const repliedMutation = useMutation({
    mutationFn: async ({ contactId, channel }: { contactId: string; channel: string }) => {
      const res = await fetch(`/api/needs-response/${contactId}/replied`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["needs-response"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Marked as responded");
    },
    onError: () => toast.error("Failed to mark as replied"),
  });

  const dismissMutation = useMutation({
    mutationFn: async ({ contactId, channel }: { contactId: string; channel: string }) => {
      const res = await fetch(`/api/needs-response/${contactId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss", channel }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["needs-response"] });
      toast("Dismissed");
    },
    onError: () => toast.error("Failed to dismiss"),
  });

  const copyPreview = useCallback(async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedKey(null), 2000);
  }, []);

  const items = data?.items ?? [];
  const filteredItems = channelFilter === "all"
    ? items
    : items.filter((i) => getChannelGroup(i.channel) === channelFilter);

  const hasEmail = items.some((i) => getChannelGroup(i.channel) === "email");
  const hasImessage = items.some((i) => getChannelGroup(i.channel) === "imessage");
  const showFilters = hasEmail && hasImessage;

  // Compute counts from items
  const highCount = items.filter((i) => i.urgency === "high").length;

  return (
    <div className="crm-animate-enter">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="ds-heading-sm">Needs response</h3>
          {highCount > 0 && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ backgroundColor: PRIORITY_STYLES.high.bg, color: PRIORITY_STYLES.high.text }}
            >
              {highCount} urgent
            </span>
          )}
        </div>
        {data && (
          <span className="ds-caption" style={{ color: "var(--text-tertiary)" }}>
            {data.totalWaiting} awaiting reply
          </span>
        )}
      </div>

      {/* Channel filter tabs */}
      {showFilters && (
        <div className="mt-3 flex gap-1">
          {(["all", "email", "imessage"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setChannelFilter(filter)}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
              style={{
                backgroundColor: channelFilter === filter ? "var(--accent-color)" : "var(--surface-sunken)",
                color: channelFilter === filter ? "white" : "var(--text-secondary)",
                transitionDuration: "var(--duration-fast)",
              }}
            >
              {filter === "all" ? "All" : filter === "email" ? "Email" : "iMessage"}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="mt-4 flex items-center gap-2 ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Scanning...
        </div>
      ) : filteredItems.length === 0 ? (
        <div
          className="mt-4 rounded-[12px] px-4 py-6 text-center"
          style={{ backgroundColor: "var(--surface-sunken)" }}
        >
          <Inbox className="mx-auto h-5 w-5" style={{ color: "var(--border-strong)" }} />
          <p className="mt-2 ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
            No one&apos;s waiting on you.
          </p>
          <p className="mt-0.5 ds-caption">You&apos;re all caught up.</p>
        </div>
      ) : (
        <div className="mt-3 space-y-0.5">
          {filteredItems.map((item) => {
            const itemKey = `${item.contactId}-${item.channel}`;
            const isExpanded = expandedKey === itemKey;
            const color = getAvatarColor(item.contactName);
            const style = PRIORITY_STYLES[item.urgency] ?? PRIORITY_STYLES.low;
            const preview = item.messages[0]?.summary ?? "";
            const daysWaiting = Math.floor(item.waitingHours / 24);

            return (
              <div
                key={itemKey}
                className="rounded-[10px] transition-colors"
                style={{
                  backgroundColor: isExpanded ? "var(--surface-sunken)" : "",
                  transitionDuration: "var(--duration-fast)",
                }}
              >
                {/* Summary row */}
                <button
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left rounded-[10px] transition-colors"
                  style={{ transitionDuration: "var(--duration-fast)" }}
                  onMouseEnter={(e) => {
                    if (!isExpanded) e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isExpanded) e.currentTarget.style.backgroundColor = "";
                  }}
                  onClick={() => setExpandedKey(isExpanded ? null : itemKey)}
                >
                  {/* Priority dot */}
                  <div
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: style.dot }}
                  />

                  {/* Avatar */}
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback
                      className="text-[10px] font-semibold"
                      style={{ backgroundColor: color.bg, color: color.text }}
                    >
                      {getInitials(item.contactName)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="ds-body-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                        {item.contactName}
                      </span>
                      <ChannelIcon channel={item.channel} />
                    </div>
                    <p className="ds-caption truncate mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                      {decodeEntities(item.lastInboundSubject ?? (preview || "No preview"))}
                    </p>
                  </div>

                  {/* Waiting badge */}
                  <span
                    className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: style.bg, color: style.text }}
                  >
                    {daysWaiting === 0 ? "Today" : `${daysWaiting}d`}
                  </span>

                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-tertiary)" }} />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-tertiary)" }} />
                  )}
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-3 pb-3">
                    <div className="ml-[52px]">
                      {/* Messages preview */}
                      {item.messages.length > 0 && (
                        <div
                          className="rounded-[8px] p-3 ds-body-sm leading-relaxed mb-2 space-y-1"
                          style={{ backgroundColor: "var(--background)", color: "var(--text-secondary)" }}
                        >
                          {item.lastInboundSubject && (
                            <p className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>
                              {decodeEntities(item.lastInboundSubject)}
                            </p>
                          )}
                          {item.messages.slice(0, 3).map((msg, i) => (
                            <p
                              key={i}
                              style={{ color: i === 0 ? "var(--text-secondary)" : "var(--text-tertiary)" }}
                            >
                              {decodeEntities(msg.summary || "")}
                            </p>
                          ))}
                          {item.messageCount > 3 && (
                            <p className="ds-caption" style={{ color: "var(--text-tertiary)" }}>
                              +{item.messageCount - 3} more message{item.messageCount - 3 !== 1 ? "s" : ""}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Meta */}
                      <p className="ds-caption mb-2" style={{ color: "var(--text-tertiary)" }}>
                        {channelLabel(item.channel)}
                        {" · "}
                        {formatDistanceToNow(new Date(item.lastInboundAt))} ago
                        {item.company && ` · ${item.company}`}
                      </p>

                      {/* Actions */}
                      <div className="flex flex-wrap gap-1.5">
                        {/* Draft a reply */}
                        <ActionButton
                          icon={FileEdit}
                          label="Draft reply"
                          onClick={() =>
                            openComposer({
                              contactId: item.contactId,
                              presetContext: "reply_email",
                              threadSubject: item.lastInboundSubject ?? undefined,
                              threadSnippet: preview || undefined,
                            })
                          }
                        />

                        {/* Copy preview */}
                        {preview && (
                          <ActionButton
                            icon={copiedKey === itemKey ? Check : Copy}
                            label={copiedKey === itemKey ? "Copied" : "Copy"}
                            onClick={() => copyPreview(itemKey, preview)}
                          />
                        )}

                        {/* View contact */}
                        <Link
                          href={`/people?contact=${item.contactId}`}
                          className="flex items-center gap-1 rounded-[6px] px-2 py-1.5 text-[11px] font-medium transition-colors"
                          style={{
                            backgroundColor: "var(--surface-sunken)",
                            color: "var(--text-secondary)",
                            transitionDuration: "var(--duration-fast)",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--border)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
                        >
                          <ExternalLink className="h-3 w-3" />
                          View
                        </Link>

                        {/* Mark responded */}
                        <ActionButton
                          icon={Check}
                          label="Responded"
                          onClick={() => repliedMutation.mutate({ contactId: item.contactId, channel: item.channel })}
                          disabled={repliedMutation.isPending}
                          variant="success"
                        />

                        {/* Dismiss */}
                        <ActionButton
                          icon={X}
                          label="Dismiss"
                          onClick={() => dismissMutation.mutate({ contactId: item.contactId, channel: item.channel })}
                          disabled={dismissMutation.isPending}
                          variant="danger"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  variant,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "danger" | "success";
}) {
  const colorMap = {
    danger: "var(--status-urgent)",
    success: "var(--status-success)",
    default: "var(--text-secondary)",
  };
  const hoverBgMap = {
    danger: "var(--status-urgent-bg)",
    success: "var(--status-success-bg)",
    default: "var(--border)",
  };

  return (
    <button
      className="flex items-center gap-1 rounded-[6px] px-2 py-1.5 text-[11px] font-medium transition-colors"
      style={{
        backgroundColor: "var(--surface-sunken)",
        color: colorMap[variant ?? "default"],
        transitionDuration: "var(--duration-fast)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = hoverBgMap[variant ?? "default"];
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
      }}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}
