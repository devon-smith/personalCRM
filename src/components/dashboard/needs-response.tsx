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

interface NeedsResponseItem {
  readonly id: string;
  readonly contactId: string;
  readonly contactName: string;
  readonly contactCompany: string | null;
  readonly contactTier: string | null;
  readonly contactAvatarUrl: string | null;
  readonly channel: "email" | "imessage";
  readonly subject: string | null;
  readonly preview: string | null;
  readonly daysWaiting: number;
  readonly lastMessageAt: string;
  readonly priority: "high" | "medium" | "low";
  readonly priorityReason: string;
}

interface NeedsResponseData {
  readonly items: NeedsResponseItem[];
  readonly counts: {
    readonly high: number;
    readonly medium: number;
    readonly low: number;
    readonly total: number;
  };
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

export function NeedsResponse() {
  const queryClient = useQueryClient();
  const { openComposer } = useDraftComposer();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<NeedsResponseData>({
    queryKey: ["needs-response"],
    queryFn: async () => {
      const res = await fetch("/api/needs-response");
      if (!res.ok) throw new Error("Failed to scan");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "dismiss" | "respond" }) => {
      const res = await fetch(`/api/needs-response/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("Failed to process action");
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["needs-response"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (variables.action === "dismiss") toast("Dismissed");
      if (variables.action === "respond") toast.success("Marked as responded");
    },
    onError: (err) => toast.error(err.message),
  });

  const copyPreview = useCallback(async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const items = data?.items ?? [];
  const filteredItems = channelFilter === "all"
    ? items
    : items.filter((i) => i.channel === channelFilter);

  const hasEmail = items.some((i) => i.channel === "email");
  const hasImessage = items.some((i) => i.channel === "imessage");
  const showFilters = hasEmail && hasImessage;

  return (
    <div className="crm-animate-enter">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="ds-heading-sm">Needs response</h3>
          {data && data.counts.high > 0 && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ backgroundColor: PRIORITY_STYLES.high.bg, color: PRIORITY_STYLES.high.text }}
            >
              {data.counts.high} urgent
            </span>
          )}
        </div>
        {data && (
          <span className="ds-caption" style={{ color: "var(--text-tertiary)" }}>
            {data.counts.total} awaiting reply
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
            const isExpanded = expandedId === item.id;
            const color = getAvatarColor(item.contactName);
            const style = PRIORITY_STYLES[item.priority];
            const ChannelIcon = item.channel === "email" ? Mail : MessageSquare;

            return (
              <div
                key={item.id}
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
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
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
                      <ChannelIcon className="h-3 w-3 shrink-0" style={{ color: "var(--text-tertiary)" }} />
                    </div>
                    <p className="ds-caption truncate mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                      {decodeEntities(item.subject ?? item.preview ?? "No preview")}
                    </p>
                  </div>

                  {/* Waiting badge */}
                  <span
                    className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: style.bg, color: style.text }}
                  >
                    {item.daysWaiting === 0 ? "Today" : `${item.daysWaiting}d`}
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
                      {/* Priority reason */}
                      <p className="ds-caption font-medium mb-2" style={{ color: style.text }}>
                        {item.priorityReason}
                      </p>

                      {/* Preview */}
                      {item.preview && (
                        <div
                          className="rounded-[8px] p-3 ds-body-sm leading-relaxed mb-2"
                          style={{ backgroundColor: "var(--background)", color: "var(--text-secondary)" }}
                        >
                          {item.subject && (
                            <p className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>
                              {decodeEntities(item.subject)}
                            </p>
                          )}
                          {decodeEntities(item.preview)}
                        </div>
                      )}

                      {/* Meta */}
                      <p className="ds-caption mb-2" style={{ color: "var(--text-tertiary)" }}>
                        {item.channel === "email" ? "Email" : "iMessage"}
                        {" · "}
                        {formatDistanceToNow(new Date(item.lastMessageAt))} ago
                        {item.contactCompany && ` · ${item.contactCompany}`}
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
                              threadSubject: item.subject ?? undefined,
                              threadSnippet: item.preview ?? undefined,
                            })
                          }
                        />

                        {/* Copy preview */}
                        {item.preview && (
                          <ActionButton
                            icon={copiedId === item.id ? Check : Copy}
                            label={copiedId === item.id ? "Copied" : "Copy"}
                            onClick={() => copyPreview(item.id, item.preview!)}
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
                          onClick={() => actionMutation.mutate({ id: item.id, action: "respond" })}
                          disabled={actionMutation.isPending}
                          variant="success"
                        />

                        {/* Dismiss */}
                        <ActionButton
                          icon={X}
                          label="Dismiss"
                          onClick={() => actionMutation.mutate({ id: item.id, action: "dismiss" })}
                          disabled={actionMutation.isPending}
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
