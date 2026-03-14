"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare,
  Loader2,
  Check,
  RefreshCw,
  Unplug,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface SyncStatus {
  configured: boolean;
  lastSyncAt: string | null;
  lastResult: {
    processed: number;
    matched: number;
    unmatched: number;
    alreadySynced: number;
    errors: number;
  } | null;
  userHandles: string[];
}

export function NotionSync() {
  const queryClient = useQueryClient();
  const [showSetup, setShowSetup] = useState(false);
  const [token, setToken] = useState("");
  const [pageId, setPageId] = useState("");
  const [handles, setHandles] = useState("");

  const { data: status, isLoading } = useQuery<SyncStatus>({
    queryKey: ["notion-sync"],
    queryFn: async () => {
      const res = await fetch("/api/notion-messages");
      if (!res.ok) throw new Error("Failed to load status");
      return res.json();
    },
  });

  const connect = useMutation({
    mutationFn: async () => {
      const userHandles = handles
        .split(/[,\n]+/)
        .map((h) => h.trim())
        .filter(Boolean);

      const res = await fetch("/api/notion-messages", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notionToken: token,
          notionPageId: pageId,
          userHandles,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Connection failed");
      }
      return res.json() as Promise<{ ok: boolean; pageTitle: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["notion-sync"] });
      setShowSetup(false);
      setToken("");
      setPageId("");
      toast.success(`Connected to "${data.pageTitle}"`);
    },
    onError: (err) => toast.error(err.message),
  });

  const sync = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/notion-messages", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Sync failed");
      }
      return res.json() as Promise<{
        processed: number;
        matched: number;
        unmatched: number;
        alreadySynced: number;
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["notion-sync"] });
      if (data.processed === 0) {
        toast("No new messages to sync");
      } else {
        toast.success(
          `Synced ${data.matched} message${data.matched !== 1 ? "s" : ""}${data.unmatched > 0 ? ` (${data.unmatched} unmatched)` : ""}`,
        );
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/notion-messages", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to disconnect");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notion-sync"] });
      toast("Disconnected Notion sync");
    },
    onError: (err) => toast.error(err.message),
  });

  function formatRelativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  if (isLoading) {
    return (
      <div className="crm-card rounded-[14px] p-5" style={{ backgroundColor: "var(--surface)" }}>
        <div
          className="h-5 w-40 animate-pulse rounded"
          style={{ backgroundColor: "var(--surface-sunken)" }}
        />
      </div>
    );
  }

  return (
    <div className="crm-card rounded-[14px] p-5" style={{ backgroundColor: "var(--surface)" }}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-[10px]"
            style={{ backgroundColor: "var(--surface-sunken)" }}
          >
            <MessageSquare className="h-5 w-5" style={{ color: "var(--text-secondary)" }} />
          </div>
          <div>
            <h3 className="ds-heading-sm">iMessage / SMS Sync</h3>
            <p className="ds-caption mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              {status?.configured
                ? "Connected via Notion"
                : "Sync messages via iOS Shortcuts + Notion"}
            </p>
          </div>
        </div>

        {status?.configured ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-[12px] rounded-lg"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
            >
              {sync.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Sync now
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-[12px] rounded-lg"
              onClick={() => {
                if (confirm("Disconnect Notion message sync?")) {
                  disconnect.mutate();
                }
              }}
              disabled={disconnect.isPending}
            >
              <Unplug className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-[12px] rounded-lg"
            onClick={() => setShowSetup(!showSetup)}
          >
            {showSetup ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            Set up
          </Button>
        )}
      </div>

      {/* Connected status with last sync info */}
      {status?.configured && status.lastResult && (
        <div
          className="mt-3 flex items-center gap-3 rounded-[10px] px-3 py-2"
          style={{ backgroundColor: "var(--surface-sunken)" }}
        >
          <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--status-success)" }} />
          <span className="ds-caption" style={{ color: "var(--text-secondary)" }}>
            Last sync: {status.lastResult.matched} matched,{" "}
            {status.lastResult.unmatched} unmatched
            {status.lastSyncAt && ` · ${formatRelativeTime(status.lastSyncAt)}`}
          </span>
        </div>
      )}

      {status?.configured && !status.lastResult && (
        <div
          className="mt-3 flex items-center gap-3 rounded-[10px] px-3 py-2"
          style={{ backgroundColor: "var(--surface-sunken)" }}
        >
          <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--status-success)" }} />
          <span className="ds-caption" style={{ color: "var(--text-secondary)" }}>
            Connected — click &quot;Sync now&quot; to pull messages
          </span>
        </div>
      )}

      {/* Setup form */}
      {showSetup && !status?.configured && (
        <div className="mt-4 space-y-4">
          {/* Instructions */}
          <div
            className="rounded-[10px] p-4 space-y-3"
            style={{
              backgroundColor: "var(--background)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <p className="ds-body-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              How it works
            </p>
            <ol className="space-y-2 ds-caption" style={{ color: "var(--text-secondary)" }}>
              <li className="flex gap-2">
                <span className="font-semibold shrink-0" style={{ color: "var(--text-tertiary)" }}>1.</span>
                <span>
                  Create a{" "}
                  <a
                    href="https://www.notion.so/profile/integrations"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline"
                    style={{ color: "var(--accent-color)" }}
                  >
                    Notion integration
                    <ExternalLink className="ml-0.5 mb-0.5 inline h-2.5 w-2.5" />
                  </a>
                  {" "}and copy the secret token
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold shrink-0" style={{ color: "var(--text-tertiary)" }}>2.</span>
                <span>Create a blank Notion page and share it with your integration</span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold shrink-0" style={{ color: "var(--text-tertiary)" }}>3.</span>
                <span>Copy the page ID from the URL (the 32-character hex string)</span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold shrink-0" style={{ color: "var(--text-tertiary)" }}>4.</span>
                <span>
                  Set up an iOS Shortcut automation: &quot;When I receive a message&quot; →
                  write sender, body, recipients, and &quot;||&quot; to the Notion page
                </span>
              </li>
            </ol>
          </div>

          {/* Form fields */}
          <div className="space-y-3">
            <div>
              <label className="ds-caption font-medium" style={{ color: "var(--text-secondary)" }}>
                Notion Integration Token
              </label>
              <input
                type="password"
                placeholder="ntn_..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="mt-1 w-full rounded-[10px] px-3 py-2 ds-body-sm outline-none"
                style={{
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  backgroundColor: "var(--background)",
                }}
              />
            </div>
            <div>
              <label className="ds-caption font-medium" style={{ color: "var(--text-secondary)" }}>
                Notion Page ID
              </label>
              <input
                type="text"
                placeholder="3208520daf7b80f9..."
                value={pageId}
                onChange={(e) => setPageId(e.target.value)}
                className="mt-1 w-full rounded-[10px] px-3 py-2 ds-body-sm outline-none"
                style={{
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  backgroundColor: "var(--background)",
                }}
              />
              <p className="mt-1 ds-caption" style={{ color: "var(--text-tertiary)" }}>
                The 32-character hex string from the Notion page URL
              </p>
            </div>
            <div>
              <label className="ds-caption font-medium" style={{ color: "var(--text-secondary)" }}>
                Your handles (one per line or comma-separated)
              </label>
              <textarea
                placeholder={"devontjsmith@gmail.com\n+17019341372"}
                value={handles}
                onChange={(e) => setHandles(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-[10px] px-3 py-2 ds-body-sm outline-none resize-none"
                style={{
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  backgroundColor: "var(--background)",
                }}
              />
              <p className="mt-1 ds-caption" style={{ color: "var(--text-tertiary)" }}>
                Your email and phone number — used to detect inbound vs outbound messages
              </p>
            </div>
          </div>

          <Button
            className="w-full h-9 gap-1.5 text-[13px] rounded-lg"
            onClick={() => connect.mutate()}
            disabled={!token || !pageId || connect.isPending}
          >
            {connect.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Connect &amp; test
          </Button>
        </div>
      )}
    </div>
  );
}
