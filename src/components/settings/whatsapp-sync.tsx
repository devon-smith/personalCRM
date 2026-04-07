"use client";

import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";

interface WhatsAppStatus {
  status: "connected" | "disconnected" | "not_configured";
  connected: boolean;
  phone?: string;
  lastMessageAt?: string | null;
  messagesSynced: number;
  contactsMatched: number;
  unmatchedChats: Array<{ phone: string; displayName: string; messageCount: number }>;
  lastSyncAt?: string;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function WhatsAppSync() {
  const [testing, setTesting] = useState(false);

  const { data, refetch } = useQuery<WhatsAppStatus>({
    queryKey: ["whatsapp-status"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/status");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 30_000,
  });

  async function testConnection() {
    setTesting(true);
    try {
      await refetch();
    } finally {
      setTesting(false);
    }
  }

  const isConnected = data?.status === "connected";
  const isConfigured = data?.status !== "not_configured";

  return (
    <div
      className="crm-card rounded-[14px] p-5"
      style={{ border: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: "rgba(37,211,102,0.1)" }}
        >
          <MessageCircle className="h-5 w-5" style={{ color: "#25D366" }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="ds-heading-sm">WhatsApp</p>
            <span
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: isConnected ? "#25D366" : "var(--text-tertiary)",
              }}
              title={isConnected ? "Connected" : "Disconnected"}
            />
          </div>
          {isConnected && data ? (
            <p className="ds-caption truncate">
              {data.phone ? `+${data.phone.replace(/^\+/, "")}` : "Connected"}
              {" · "}
              {data.messagesSynced} messages synced
              {" · "}
              {data.contactsMatched} contacts matched
              {data.lastSyncAt && ` · ${formatRelativeTime(data.lastSyncAt)}`}
            </p>
          ) : isConfigured ? (
            <p className="ds-caption">
              Sidecar disconnected. Restart to resume sync.
            </p>
          ) : (
            <p className="ds-caption">
              Not configured yet.
            </p>
          )}
        </div>
        <button
          onClick={testConnection}
          disabled={testing}
          className="flex items-center gap-1 rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
          style={{
            backgroundColor: "var(--surface-sunken)",
            color: "var(--text-secondary)",
            transitionDuration: "var(--duration-fast)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--border)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
          }}
        >
          {testing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Test
        </button>
      </div>

      {/* Setup instructions when not configured */}
      {!isConfigured && (
        <div
          className="mt-4 rounded-[10px] px-4 py-3 text-[12px] space-y-1.5"
          style={{
            backgroundColor: "var(--surface-sunken)",
            color: "var(--text-secondary)",
            lineHeight: "1.6",
          }}
        >
          <p className="font-medium" style={{ color: "var(--text-primary)" }}>
            Setup instructions:
          </p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>
              Navigate to{" "}
              <code
                className="rounded px-1 py-0.5 text-[11px]"
                style={{ backgroundColor: "var(--border)" }}
              >
                whatsapp-sidecar/
              </code>
            </li>
            <li>
              Copy{" "}
              <code
                className="rounded px-1 py-0.5 text-[11px]"
                style={{ backgroundColor: "var(--border)" }}
              >
                .env.example
              </code>
              {" to "}
              <code
                className="rounded px-1 py-0.5 text-[11px]"
                style={{ backgroundColor: "var(--border)" }}
              >
                .env
              </code>
              {" and set your extension token"}
            </li>
            <li>
              Run{" "}
              <code
                className="rounded px-1 py-0.5 text-[11px]"
                style={{ backgroundColor: "var(--border)" }}
              >
                npm start
              </code>
              {" and scan the QR code with WhatsApp"}
            </li>
          </ol>
        </div>
      )}

      {/* Unmatched chats */}
      {isConnected && data && data.unmatchedChats.length > 0 && (
        <div className="mt-4">
          <p
            className="text-[11px] font-medium mb-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            {data.unmatchedChats.length} unmatched chat
            {data.unmatchedChats.length !== 1 ? "s" : ""}
          </p>
          <div className="space-y-1">
            {data.unmatchedChats.slice(0, 5).map((chat) => (
              <div
                key={chat.phone}
                className="flex items-center justify-between rounded-[8px] px-3 py-1.5"
                style={{ backgroundColor: "var(--surface-sunken)" }}
              >
                <span
                  className="text-[12px] truncate"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {chat.displayName || chat.phone}
                </span>
                <span
                  className="text-[11px] shrink-0 ml-2"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {chat.messageCount} msg{chat.messageCount !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
            {data.unmatchedChats.length > 5 && (
              <p
                className="text-[11px] px-3"
                style={{ color: "var(--text-tertiary)" }}
              >
                +{data.unmatchedChats.length - 5} more
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
