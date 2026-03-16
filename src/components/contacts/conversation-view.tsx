"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Mail, Linkedin, Loader2, ChevronUp, Send, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDraftComposer } from "@/lib/draft-composer-context";

// ─── Types ──────────────────────────────────────────────────

interface Message {
  readonly id: string;
  readonly type: string;
  readonly direction: "INBOUND" | "OUTBOUND";
  readonly summary: string | null;
  readonly subject: string | null;
  readonly occurredAt: string;
  readonly sourceId: string | null;
}

interface ChannelData {
  readonly channel: string;
  readonly messageCount: number;
  readonly hasMore: boolean;
  readonly latestAt: string | null;
  readonly messages: readonly Message[];
}

interface ConversationContact {
  readonly id: string;
  readonly name: string;
  readonly company: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly linkedinUrl: string | null;
}

interface ConversationResponse {
  readonly channels: readonly ChannelData[];
  readonly contact: ConversationContact;
}

interface ConversationViewProps {
  readonly contactId: string;
}

// ─── Channel icons & labels ─────────────────────────────────

const channelConfig: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  iMessage: { icon: MessageSquare, label: "iMessage", color: "#34C759" },
  SMS: { icon: MessageSquare, label: "SMS", color: "#34C759" },
  gmail: { icon: Mail, label: "Email", color: "#EA4335" },
  email: { icon: Mail, label: "Email", color: "#EA4335" },
  linkedin: { icon: Linkedin, label: "LinkedIn", color: "#0A66C2" },
  other: { icon: MessageSquare, label: "Other", color: "#7B8189" },
};

// ─── Date formatting ────────────────────────────────────────

function formatDateSeparator(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDate.getTime() === today.getTime()) return "Today";
  if (msgDate.getTime() === yesterday.getTime()) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ─── Component ──────────────────────────────────────────────

export function ConversationView({ contactId }: ConversationViewProps) {
  const { openComposer } = useDraftComposer();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);

  const { data, isLoading } = useQuery<ConversationResponse>({
    queryKey: ["conversations", contactId, limit],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/conversations?limit=${limit}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!contactId,
  });

  // Default to channel with most recent message
  useEffect(() => {
    if (data?.channels.length && !activeChannel) {
      setActiveChannel(data.channels[0].channel);
    }
  }, [data, activeChannel]);

  // Auto-scroll to bottom on initial load
  useEffect(() => {
    if (data && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data, activeChannel]);

  const activeData = useMemo(() => {
    if (!data) return null;
    if (activeChannel === "all") {
      // Merge all channels chronologically
      const allMessages = data.channels.flatMap((ch) =>
        ch.messages.map((m) => ({ ...m, channel: ch.channel })),
      );
      allMessages.sort(
        (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
      );
      return {
        channel: "all",
        messageCount: allMessages.length,
        hasMore: data.channels.some((ch) => ch.hasMore),
        messages: allMessages,
      };
    }
    return data.channels.find((ch) => ch.channel === activeChannel) ?? null;
  }, [data, activeChannel]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!data || data.channels.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-gray-400">
        No conversations yet
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Channel tabs */}
      <div className="flex gap-1 px-1 pb-2 pt-1 overflow-x-auto">
        <ChannelTab
          label="All"
          count={data.channels.reduce((s, c) => s + c.messageCount, 0)}
          active={activeChannel === "all"}
          onClick={() => setActiveChannel("all")}
        />
        {data.channels.map((ch) => {
          const config = channelConfig[ch.channel] ?? channelConfig.other;
          return (
            <ChannelTab
              key={ch.channel}
              label={config.label}
              count={ch.messageCount}
              active={activeChannel === ch.channel}
              onClick={() => setActiveChannel(ch.channel)}
              icon={config.icon}
              color={config.color}
            />
          );
        })}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-1 pb-2">
        {activeData && (
          <>
            {/* Load more button */}
            {activeData.hasMore && (
              <div className="flex justify-center py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] text-gray-400"
                  onClick={() => setLimit((l) => l + 100)}
                >
                  <ChevronUp className="h-3 w-3 mr-1" />
                  Load older messages
                </Button>
              </div>
            )}

            <MessageList
              messages={activeData.messages}
              isEmail={activeChannel === "gmail" || activeChannel === "email"}
              showChannelBadge={activeChannel === "all"}
            />
          </>
        )}
      </div>

      {/* Bottom bar */}
      <div className="flex items-center gap-2 border-t border-gray-100 px-3 py-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[12px] rounded-lg flex-1"
          onClick={() => openComposer({ contactId })}
        >
          <Send className="h-3 w-3 mr-1.5" />
          Draft reply
        </Button>
        {data.contact.phone && (
          <a href={`sms:${data.contact.phone}`}>
            <Button variant="ghost" size="sm" className="h-8 text-[11px] rounded-lg text-gray-400">
              <ExternalLink className="h-3 w-3 mr-1" />
              Messages
            </Button>
          </a>
        )}
        {data.contact.email && (
          <a href={`mailto:${data.contact.email}`}>
            <Button variant="ghost" size="sm" className="h-8 text-[11px] rounded-lg text-gray-400">
              <ExternalLink className="h-3 w-3 mr-1" />
              Gmail
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Channel tab ────────────────────────────────────────────

function ChannelTab({
  label,
  count,
  active,
  onClick,
  icon: Icon,
  color,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  icon?: React.ElementType;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors"
      style={{
        backgroundColor: active ? "#F3F4F6" : "transparent",
        color: active ? "#1A1A1A" : "#9BA1A8",
      }}
    >
      {Icon && <Icon className="h-3 w-3" style={{ color: active ? (color ?? "#1A1A1A") : "#9BA1A8" }} />}
      {label}
      <span className="text-[10px] font-normal" style={{ color: "#9BA1A8" }}>
        {count}
      </span>
    </button>
  );
}

// ─── Message list with date separators ──────────────────────

function MessageList({
  messages,
  isEmail,
  showChannelBadge,
}: {
  messages: readonly (Message & { channel?: string })[];
  isEmail: boolean;
  showChannelBadge: boolean;
}) {
  let lastDate = "";

  return (
    <div className="space-y-1">
      {messages.map((msg) => {
        const date = new Date(msg.occurredAt);
        const dateKey = date.toDateString();
        const showSeparator = dateKey !== lastDate;
        lastDate = dateKey;

        return (
          <div key={msg.id}>
            {showSeparator && <DateSeparator date={date} />}
            {isEmail ? (
              <EmailCard msg={msg} showChannelBadge={showChannelBadge} />
            ) : (
              <ChatBubble msg={msg} showChannelBadge={showChannelBadge} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Date separator ─────────────────────────────────────────

function DateSeparator({ date }: { date: Date }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="h-px flex-1 bg-gray-100" />
      <span className="text-[10px] font-medium uppercase tracking-[0.05em] text-gray-400">
        {formatDateSeparator(date)}
      </span>
      <div className="h-px flex-1 bg-gray-100" />
    </div>
  );
}

// ─── Chat bubble ────────────────────────────────────────────

function ChatBubble({
  msg,
  showChannelBadge,
}: {
  msg: Message & { channel?: string };
  showChannelBadge: boolean;
}) {
  const isOutbound = msg.direction === "OUTBOUND";
  const time = formatTime(new Date(msg.occurredAt));

  if (!msg.summary) return null;

  return (
    <div className={`flex ${isOutbound ? "justify-end" : "justify-start"} px-1`}>
      <div className={`flex items-end gap-1.5 max-w-[80%] ${isOutbound ? "flex-row-reverse" : ""}`}>
        <div
          className="px-3 py-2 text-[13px] leading-[1.5]"
          style={{
            backgroundColor: isOutbound ? "#E8F0FE" : "#F2F3F5",
            color: "#1A1A1A",
            borderRadius: isOutbound ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
            wordBreak: "break-word",
          }}
        >
          {showChannelBadge && msg.channel && (
            <span className="text-[9px] font-medium uppercase tracking-wider text-gray-400 block mb-0.5">
              {channelConfig[msg.channel]?.label ?? msg.channel}
            </span>
          )}
          {msg.summary}
        </div>
        <span className="shrink-0 pb-0.5 text-[10px] text-gray-400">{time}</span>
      </div>
    </div>
  );
}

// ─── Email card ─────────────────────────────────────────────

function EmailCard({
  msg,
  showChannelBadge,
}: {
  msg: Message & { channel?: string };
  showChannelBadge: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOutbound = msg.direction === "OUTBOUND";
  const date = new Date(msg.occurredAt);
  const summary = msg.summary ?? "";
  const truncated = summary.length > 200 && !expanded;

  return (
    <div
      className="mx-1 rounded-xl border p-3 my-1.5"
      style={{
        borderColor: isOutbound ? "#D4E4FC" : "#E8EAED",
        backgroundColor: isOutbound ? "#F7FAFF" : "#FAFAFA",
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Mail className="h-3 w-3 text-gray-400" />
          <span className="text-[11px] font-medium text-gray-500">
            {isOutbound ? "Sent" : "Received"}
          </span>
          {showChannelBadge && msg.channel && (
            <span className="text-[9px] font-medium uppercase tracking-wider text-gray-400">
              {channelConfig[msg.channel]?.label ?? msg.channel}
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-400">
          {formatTime(date)}
        </span>
      </div>
      {msg.subject && (
        <p className="text-[13px] font-medium text-gray-900 mb-1">{msg.subject}</p>
      )}
      {summary && (
        <p className="text-[12px] text-gray-600 leading-[1.5] whitespace-pre-wrap">
          {truncated ? summary.slice(0, 200) + "..." : summary}
        </p>
      )}
      {summary.length > 200 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[11px] font-medium text-blue-500 hover:text-blue-700"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
