"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import {
  RefreshCw,
  Loader2,
  Mail,
  Calendar,
  Users,
  Smartphone,
  MessageCircle,
  Check,
  ExternalLink,
  Plus,
  ChevronDown,
  ChevronRight,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { LinkedInImport } from "@/components/settings/linkedin-import";
import type { DataHealthResponse, GoogleAccountInfo } from "@/app/api/data-health/route";
import type { CalendarSyncResult } from "@/app/api/calendar/route";
import type { IMessageSyncResult } from "@/app/api/imessage/route";

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

export default function IntegrationsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<DataHealthResponse>({
    queryKey: ["data-health"],
    queryFn: async () => {
      const res = await fetch("/api/data-health");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  // ─── Sync mutations ───
  const syncGmail = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/gmail/sync", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Sync failed");
      return res.json();
    },
    onSuccess: (result) => {
      toast(`Synced ${result.processed} emails`);
      queryClient.invalidateQueries({ queryKey: ["data-health"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const importContacts = useMutation({
    mutationFn: async () => {
      const previewRes = await fetch("/api/gmail/contacts");
      if (!previewRes.ok) throw new Error("Failed to fetch Google Contacts");
      const { contacts } = await previewRes.json();
      const importRes = await fetch("/api/gmail/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts }),
      });
      if (!importRes.ok) throw new Error("Failed to import contacts");
      return importRes.json();
    },
    onSuccess: (result) => {
      toast(`Imported ${result.imported} contacts`);
      queryClient.invalidateQueries({ queryKey: ["data-health"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const syncCalendar = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/calendar", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Calendar sync failed");
      return res.json() as Promise<CalendarSyncResult>;
    },
    onSuccess: (result) => {
      toast(result.interactionsLogged > 0
        ? `Calendar: ${result.interactionsLogged} meetings logged`
        : `Scanned ${result.eventsScanned} events — all synced`);
      queryClient.invalidateQueries({ queryKey: ["data-health"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const importApple = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/contacts/apple", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Apple import failed");
      return res.json() as Promise<{ created: number; enriched: number; skipped: number; total: number }>;
    },
    onSuccess: (result) => {
      const parts: string[] = [];
      if (result.created > 0) parts.push(`${result.created} created`);
      if (result.enriched > 0) parts.push(`${result.enriched} enriched`);
      toast(parts.length > 0 ? `Apple Contacts: ${parts.join(", ")}` : "All contacts already synced");
      queryClient.invalidateQueries({ queryKey: ["data-health"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const syncIMessage = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/imessage", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "iMessage sync failed");
      return res.json() as Promise<IMessageSyncResult>;
    },
    onSuccess: (result) => {
      toast(result.interactionsLogged > 0
        ? `iMessage: ${result.interactionsLogged} conversations logged`
        : "All conversations already synced");
      queryClient.invalidateQueries({ queryKey: ["data-health"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const isSyncing = syncGmail.isPending || importContacts.isPending || syncCalendar.isPending || importApple.isPending || syncIMessage.isPending;

  // Auto-sync after adding a new Google account
  const didAutoSync = useRef(false);
  useEffect(() => {
    if (didAutoSync.current || !data) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("sync") !== "true") return;
    didAutoSync.current = true;
    const addedEmail = params.get("added");
    if (addedEmail) toast(`Connected ${addedEmail}`);
    syncGmail.mutate();
    importContacts.mutate();
    syncCalendar.mutate();
    window.history.replaceState({}, "", "/integrations");
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSyncAll() {
    if (!data) return;
    syncGmail.mutate();
    importContacts.mutate();
    syncCalendar.mutate();
    importApple.mutate();
    syncIMessage.mutate();
  }

  // Calculate data quality score
  const qualityScore = data
    ? Math.round(
        data.coverage.reduce((sum, c) => {
          const pct = c.total > 0 ? c.current / c.total : 0;
          return sum + pct;
        }, 0) / Math.max(data.coverage.length, 1) * 100
      )
    : 0;

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-[600px] pt-14">
        <h1 className="ds-display-lg">Integrations</h1>
        <div className="mt-8 flex items-center gap-2 ds-body-sm">
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--text-tertiary)" }} />
          <span style={{ color: "var(--text-tertiary)" }}>Loading...</span>
        </div>
      </div>
    );
  }

  const sourceByKey = (key: string) => data.sources.find((s) => s.key === key);

  return (
    <div className="mx-auto max-w-[600px] pt-14 pb-16">
      {/* Header */}
      <div className="crm-animate-enter flex items-center justify-between">
        <h1 className="ds-display-lg">Integrations</h1>
        <button
          onClick={handleSyncAll}
          disabled={isSyncing}
          className="flex items-center gap-2 rounded-[10px] px-4 py-2 ds-body-sm font-medium transition-colors disabled:opacity-50"
          style={{
            backgroundColor: "var(--accent-color)",
            color: "var(--text-inverse)",
            transitionDuration: "var(--duration-fast)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--accent-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--accent-color)"; }}
        >
          {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Sync all
        </button>
      </div>

      {/* ═══ SECTION 1 — Google Accounts ═══ */}
      <div className="crm-animate-enter mt-8 space-y-3" style={{ animationDelay: "40ms" }}>
        <h2 className="ds-heading-sm">Google Accounts</h2>

        {data.googleAccounts.length > 0 ? (
          <>
            {data.googleAccounts.map((account) => (
              <GoogleAccountCard
                key={account.id}
                account={account}
                gmailSource={sourceByKey("gmail")}
                calendarSource={sourceByKey("google-calendar")}
                contactsSource={sourceByKey("google-contacts")}
                syncGmail={syncGmail}
                syncCalendar={syncCalendar}
                importContacts={importContacts}
              />
            ))}

            <a
              href="/api/auth/add-google-account"
              className="flex items-center gap-2 rounded-[14px] px-5 py-3.5 w-full transition-colors"
              style={{
                border: "1px dashed var(--border-strong)",
                color: "var(--text-tertiary)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
            >
              <Plus className="h-4 w-4" />
              <span className="text-[13px] font-medium">Add another Google account</span>
            </a>
          </>
        ) : (
          <div
            className="crm-card rounded-[14px] p-5"
            style={{ border: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3">
              <GoogleIcon />
              <div className="flex-1">
                <p className="ds-heading-sm">Google</p>
                <p className="ds-caption">Connect to sync Gmail, Calendar, and Contacts</p>
              </div>
              <a
                href="/login?force=true"
                className="flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors"
                style={{ backgroundColor: "var(--accent-color)", color: "var(--text-inverse)" }}
              >
                <ExternalLink className="h-3 w-3" />
                Connect
              </a>
            </div>
          </div>
        )}
      </div>

      {/* ═══ SECTION 2 — Local Sources ═══ */}
      <div className="crm-animate-enter mt-8 space-y-3" style={{ animationDelay: "80ms" }}>
        <h2 className="ds-heading-sm">Local Sources</h2>

        {/* Apple Contacts */}
        <SourceCard
          icon={Smartphone}
          iconBg="var(--surface-sunken)"
          iconColor="var(--text-secondary)"
          name="Apple Contacts"
          source={sourceByKey("apple-contacts")}
          isSyncing={importApple.isPending}
          onSync={() => importApple.mutate()}
          actionLabel="Import"
        />

        {/* iMessage */}
        <SourceCard
          icon={MessageCircle}
          iconBg="var(--status-success-bg)"
          iconColor="var(--status-success)"
          name="iMessage"
          source={sourceByKey("imessage")}
          isSyncing={syncIMessage.isPending}
          onSync={() => syncIMessage.mutate()}
        />
      </div>

      {/* ═══ SECTION 3 — Imports ═══ */}
      <div className="crm-animate-enter mt-8 space-y-3" style={{ animationDelay: "120ms" }}>
        <h2 className="ds-heading-sm">Imports</h2>

        {/* LinkedIn */}
        <div
          className="crm-card rounded-[14px] p-5"
          style={{ border: "1px solid var(--border)" }}
        >
          <LinkedInImport />
          {sourceByKey("linkedin")?.lastSync && (
            <p className="mt-2 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              {sourceByKey("linkedin")!.captured}
            </p>
          )}
          {sourceByKey("linkedin")?.status === "connected" && (
            <p className="mt-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              {sourceByKey("linkedin")!.captured}
            </p>
          )}
        </div>
      </div>

      {/* ═══ SECTION 4 — Data Health ═══ */}
      <div className="crm-animate-enter mt-10" style={{ animationDelay: "160ms" }}>
        <div className="flex items-center justify-between">
          <h2 className="ds-heading-sm">Data Health</h2>
          <div className="flex items-center gap-2">
            <span className="ds-stat-md">{qualityScore}</span>
            <span className="ds-caption">/100</span>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {data.coverage.map((stat) => {
            const pct = stat.total > 0 ? Math.round((stat.current / stat.total) * 100) : 0;
            const barColor = pct >= 70 ? "var(--warmth-good)" : pct >= 40 ? "var(--warmth-mid)" : "var(--warmth-cold)";
            return (
              <div key={stat.key}>
                <div className="flex items-center justify-between ds-body-sm">
                  <span style={{ color: "var(--text-secondary)" }} className="capitalize">{stat.key} coverage</span>
                  <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                    {stat.current}/{stat.total} ({pct}%)
                  </span>
                </div>
                <div
                  className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
                  style={{ backgroundColor: "var(--surface-sunken)" }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: barColor, transitionDuration: "var(--duration-normal)" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Google Account Card with expandable services ───

function GoogleAccountCard({
  account,
  gmailSource,
  calendarSource,
  contactsSource,
  syncGmail,
  syncCalendar,
  importContacts,
}: {
  account: GoogleAccountInfo;
  gmailSource?: DataHealthResponse["sources"][0];
  calendarSource?: DataHealthResponse["sources"][0];
  contactsSource?: DataHealthResponse["sources"][0];
  syncGmail: ReturnType<typeof useMutation<unknown, Error>>;
  syncCalendar: ReturnType<typeof useMutation<unknown, Error>>;
  importContacts: ReturnType<typeof useMutation<unknown, Error>>;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div
      className="crm-card rounded-[14px] overflow-hidden"
      style={{ border: "1px solid var(--border)" }}
    >
      {/* Account header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors"
        style={{ transitionDuration: "var(--duration-fast)" }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
      >
        <GoogleIcon />
        <div className="min-w-0 flex-1">
          <p className="ds-body-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
            {account.email}
          </p>
          <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            {[
              account.hasGmail && "Gmail",
              account.hasCalendar && "Calendar",
              account.hasContacts && "Contacts",
            ].filter(Boolean).join(" · ")}
          </p>
        </div>
        {expanded
          ? <ChevronDown className="h-4 w-4 shrink-0" style={{ color: "var(--text-tertiary)" }} />
          : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--text-tertiary)" }} />
        }
      </button>

      {/* Expandable services */}
      {expanded && (
        <div className="space-y-px px-4 pb-4">
          {account.hasGmail && (
            <SubService
              icon={Mail}
              name="Gmail"
              detail={gmailSource?.captured ?? "Not synced"}
              lastSync={gmailSource?.lastSync}
              canSync={true}
              isSyncing={syncGmail.isPending}
              onSync={() => syncGmail.mutate()}
            />
          )}
          {account.hasCalendar && (
            <SubService
              icon={Calendar}
              name="Calendar"
              detail={calendarSource?.captured ?? "Not synced"}
              lastSync={calendarSource?.lastSync}
              canSync={true}
              isSyncing={syncCalendar.isPending}
              onSync={() => syncCalendar.mutate()}
            />
          )}
          {account.hasContacts && (
            <SubService
              icon={Users}
              name="Contacts"
              detail={contactsSource?.captured ?? "Not imported"}
              lastSync={contactsSource?.lastSync}
              canSync={true}
              isSyncing={importContacts.isPending}
              onSync={() => importContacts.mutate()}
              actionLabel="Enrich"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Reusable source card for non-Google sources ───

function SourceCard({
  icon: Icon,
  iconBg,
  iconColor,
  name,
  source,
  isSyncing,
  onSync,
  actionLabel = "Sync",
}: {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  name: string;
  source?: DataHealthResponse["sources"][0];
  isSyncing: boolean;
  onSync: () => void;
  actionLabel?: string;
}) {
  return (
    <div
      className="crm-card rounded-[14px] p-5"
      style={{ border: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: iconBg }}
        >
          <Icon className="h-5 w-5" style={{ color: iconColor }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="ds-heading-sm">{name}</p>
          <p className="ds-caption truncate">
            {source?.captured ?? "Not synced"}
            {source?.lastSync && (
              <span> · Last sync: {formatRelativeTime(source.lastSync)}</span>
            )}
          </p>
        </div>
        <button
          onClick={onSync}
          disabled={isSyncing}
          className="flex items-center gap-1 rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
          style={{
            backgroundColor: "var(--surface-sunken)",
            color: "var(--text-secondary)",
            transitionDuration: "var(--duration-fast)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--border)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
        >
          {isSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Sub-service row (Gmail, Calendar, Contacts within a Google account) ───

function SubService({
  icon: Icon,
  name,
  detail,
  lastSync,
  canSync,
  isSyncing,
  onSync,
  actionLabel = "Sync",
}: {
  icon: React.ElementType;
  name: string;
  detail: string;
  lastSync?: string | null;
  canSync: boolean;
  isSyncing: boolean;
  onSync: () => void;
  actionLabel?: string;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-[10px] px-3 py-2.5"
      style={{ backgroundColor: "var(--surface-sunken)" }}
    >
      <Check className="h-4 w-4 shrink-0" style={{ color: "var(--status-success)" }} />
      <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--text-tertiary)" }} />
      <div className="min-w-0 flex-1">
        <span className="ds-body-sm font-medium" style={{ color: "var(--text-primary)" }}>{name}</span>
        <p className="text-[11px] truncate" style={{ color: "var(--text-tertiary)" }}>
          {detail}
          {lastSync && ` · ${formatRelativeTime(lastSync)}`}
        </p>
      </div>
      <button
        onClick={onSync}
        disabled={isSyncing}
        className="flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50"
        style={{
          backgroundColor: "var(--surface)",
          color: "var(--text-secondary)",
          border: "1px solid var(--border)",
          transitionDuration: "var(--duration-fast)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--surface)"; }}
      >
        {isSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        {actionLabel}
      </button>
    </div>
  );
}

// ─── Google icon SVG ───

function GoogleIcon() {
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]"
      style={{ backgroundColor: "var(--surface-sunken)" }}
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    </div>
  );
}
