"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Loader2, ChevronDown, UserPlus, ExternalLink, Mail, Users, Calendar, Sparkles, Check, Smartphone, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import type { DataHealthResponse, DataSource } from "@/app/api/data-health/route";
import type { DiscoverResult } from "@/app/api/gmail/discover/route";
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

function StatusDot({ status }: { status: DataSource["status"] }) {
  const color =
    status === "connected"
      ? "#4A8C5E"
      : status === "available"
        ? "#C4962E"
        : "#C8CDD3";
  return (
    <div
      className="shrink-0 rounded-full"
      style={{ width: 7, height: 7, backgroundColor: color }}
    />
  );
}

function CoverageBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  const color = pct >= 70 ? "#4A8C5E" : pct >= 40 ? "#C4962E" : "#BF5040";
  return (
    <div
      className="overflow-hidden rounded-full"
      style={{ height: 3, width: 80, background: "#EEEFF1" }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

function SourceAction({
  source,
  isSyncing,
  onSync,
  hasGoogleOAuth,
}: {
  source: DataSource;
  isSyncing: boolean;
  onSync: () => void;
  hasGoogleOAuth: boolean;
}) {
  // Source can actually sync — show Sync button
  if (source.canSync) {
    return (
      <button
        className="flex items-center gap-1 rounded-md bg-[#F3F4F6] px-2.5 py-1 text-[11px] font-medium text-[#7B8189] transition-colors hover:bg-[#EDEEF0] hover:text-[#4A4E54]"
        onClick={onSync}
        disabled={isSyncing}
      >
        {isSyncing ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
        Sync
      </button>
    );
  }

  // Google source but no OAuth — show Connect button
  if (
    (source.key === "google-contacts" || source.key === "gmail" || source.key === "google-calendar") &&
    !hasGoogleOAuth
  ) {
    return (
      <a
        href="/api/auth/signin?callbackUrl=/settings"
        className="flex items-center gap-1 rounded-md bg-[#F3F4F6] px-2.5 py-1 text-[11px] font-medium text-[#7B8189] transition-colors hover:bg-[#EDEEF0] hover:text-[#6366F1]"
      >
        <ExternalLink className="h-3 w-3" />
        Connect
      </a>
    );
  }

  // Coming soon — show label
  if (source.status === "coming_soon") {
    return (
      <span className="text-[11px] text-[#C8CDD3]">Coming soon</span>
    );
  }

  // Available but needs scope re-auth
  if (source.status === "available") {
    return (
      <a
        href="/login?force=true"
        className="flex items-center gap-1 rounded-md bg-[#F3F4F6] px-2.5 py-1 text-[11px] font-medium text-[#7B8189] transition-colors hover:bg-[#EDEEF0] hover:text-[#6366F1]"
      >
        <ExternalLink className="h-3 w-3" />
        Authorize
      </a>
    );
  }

  return null;
}

function GoogleConnectBanner() {
  return (
    <div className="mt-5 rounded-[14px] border border-[#E8EAED] bg-white px-5 py-5">
      <div className="flex items-start gap-4">
        <div
          className="flex shrink-0 items-center justify-center rounded-[12px] bg-[#F3F4F6]"
          style={{ width: 40, height: 40 }}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <h3
            className="text-[14px] font-semibold text-[#1A1A1A]"
            style={{ letterSpacing: "-0.02em" }}
          >
            Connect Google
          </h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[#9BA1A8]">
            Sign in with Google to unlock automatic syncing from these sources:
          </p>

          <div className="mt-3 space-y-1.5">
            <div className="flex items-center gap-2 text-[12px] text-[#7B8189]">
              <Users className="h-3.5 w-3.5 text-[#B5BAC0]" />
              <span><span className="font-medium text-[#4A4E54]">Contacts</span> — import your address book</span>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-[#7B8189]">
              <Mail className="h-3.5 w-3.5 text-[#B5BAC0]" />
              <span><span className="font-medium text-[#4A4E54]">Gmail</span> — track email interactions automatically</span>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-[#7B8189]">
              <Calendar className="h-3.5 w-3.5 text-[#B5BAC0]" />
              <span><span className="font-medium text-[#4A4E54]">Calendar</span> — sync meetings as interactions</span>
            </div>
          </div>

          <a
            href="/login?force=true"
            className="mt-4 inline-flex items-center gap-2 rounded-[10px] bg-[#1A1A1A] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#2D2D2D]"
          >
            Connect Google account
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

export function DataHealth() {
  const queryClient = useQueryClient();
  const [showZeroContacts, setShowZeroContacts] = useState(false);
  const [showUnmatched, setShowUnmatched] = useState(false);

  const { data, isLoading } = useQuery<DataHealthResponse>({
    queryKey: ["data-health"],
    queryFn: async () => {
      const res = await fetch("/api/data-health");
      if (!res.ok) throw new Error("Failed to fetch data health");
      return res.json();
    },
  });

  const syncGmail = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/gmail/sync", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Sync failed");
      }
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

  const discoverGmail = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/gmail/discover", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Discovery failed");
      }
      return res.json() as Promise<DiscoverResult>;
    },
    onSuccess: (result) => {
      const parts: string[] = [];
      if (result.contactsCreated > 0) parts.push(`Created ${result.contactsCreated} contacts`);
      if (result.interactionsLogged > 0) parts.push(`logged ${result.interactionsLogged} interactions`);
      if (result.contactsCleaned > 0) parts.push(`removed ${result.contactsCleaned} non-personal contacts`);
      if (parts.length > 0) {
        toast(parts.join(", "));
      } else {
        toast(`All ${result.peopleFound} people already synced`);
      }
      queryClient.invalidateQueries({ queryKey: ["data-health"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["circles"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const importApple = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/contacts/apple", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Apple import failed");
      }
      return res.json() as Promise<{ created: number; enriched: number; skipped: number; total: number }>;
    },
    onSuccess: (result) => {
      const parts: string[] = [];
      if (result.created > 0) parts.push(`${result.created} created`);
      if (result.enriched > 0) parts.push(`${result.enriched} enriched`);
      if (parts.length > 0) {
        toast(`Apple Contacts: ${parts.join(", ")}`);
      } else {
        toast(`All ${result.total} Apple contacts already synced`);
      }
      queryClient.invalidateQueries({ queryKey: ["data-health"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["circles"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const syncCalendar = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/calendar", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Calendar sync failed");
      }
      return res.json() as Promise<CalendarSyncResult>;
    },
    onSuccess: (result) => {
      const parts: string[] = [];
      if (result.interactionsLogged > 0) parts.push(`${result.interactionsLogged} meetings logged`);
      if (result.contactsMatched > 0) parts.push(`${result.contactsMatched} contacts matched`);
      if (parts.length > 0) {
        toast(`Calendar: ${parts.join(", ")}`);
      } else {
        toast(`Scanned ${result.eventsScanned} events — all already synced`);
      }
      queryClient.invalidateQueries({ queryKey: ["data-health"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const syncIMessage = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/imessage", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "iMessage sync failed");
      }
      return res.json() as Promise<IMessageSyncResult>;
    },
    onSuccess: (result) => {
      const parts: string[] = [];
      if (result.interactionsLogged > 0) parts.push(`${result.interactionsLogged} conversations logged`);
      if (result.contactsMatched > 0) parts.push(`${result.contactsMatched} contacts matched`);
      if (parts.length > 0) {
        toast(`iMessage: ${parts.join(", ")}`);
      } else {
        toast(`Scanned ${result.conversationsScanned} conversations — all already synced`);
      }
      queryClient.invalidateQueries({ queryKey: ["data-health"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const isSyncing = syncGmail.isPending || importContacts.isPending || discoverGmail.isPending || importApple.isPending || syncCalendar.isPending || syncIMessage.isPending;

  function handleSync(key: string) {
    if (key === "gmail") syncGmail.mutate();
    else if (key === "google-contacts") importContacts.mutate();
    else if (key === "google-calendar") syncCalendar.mutate();
    else if (key === "imessage") syncIMessage.mutate();
  }

  function handleSyncAll() {
    const syncable = data?.sources.filter((s) => s.canSync);
    if (!syncable?.length) {
      toast("No sources available to sync");
      return;
    }
    if (syncable.some((s) => s.key === "google-contacts")) {
      importContacts.mutate();
    }
    if (syncable.some((s) => s.key === "gmail")) {
      syncGmail.mutate();
    }
    if (syncable.some((s) => s.key === "google-calendar")) {
      syncCalendar.mutate();
    }
    if (syncable.some((s) => s.key === "imessage")) {
      syncIMessage.mutate();
    }
  }

  if (isLoading) {
    return (
      <section className="crm-animate-enter">
        <h2
          className="text-[18px] font-semibold text-[#1A1A1A]"
          style={{ letterSpacing: "-0.03em" }}
        >
          Data health
        </h2>
        <div className="mt-4 flex items-center gap-2 text-[13px] text-[#C1C5CA]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading...
        </div>
      </section>
    );
  }

  if (!data) return null;

  const zeroCount = data.zeroInteractionContacts.length;
  const unmatchedCount = data.unmatchedSenders.length;
  const hasSyncableSources = data.sources.some((s) => s.canSync);

  return (
    <section className="crm-animate-enter">
      {/* ── Data Sources ── */}
      <div className="flex items-baseline justify-between">
        <h2
          className="text-[18px] font-semibold text-[#1A1A1A]"
          style={{ letterSpacing: "-0.03em" }}
        >
          Data health
        </h2>
        {hasSyncableSources && (
          <button
            className="flex items-center gap-1.5 text-[12px] font-medium text-[#B5BAC0] transition-colors hover:text-[#6366F1]"
            onClick={handleSyncAll}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Sync all
          </button>
        )}
      </div>

      <p className="mt-1 text-[13px] text-[#B5BAC0]">
        What&apos;s connected, captured, and where the gaps are.
      </p>

      {!data.hasGoogleOAuth && <GoogleConnectBanner />}

      {data.hasGoogleOAuth && (
        <div className="mt-5 rounded-[14px] border border-[#E8EAED] bg-white px-5 py-5">
          <div className="flex items-start gap-4">
            <div
              className="flex shrink-0 items-center justify-center rounded-[12px]"
              style={{
                width: 40,
                height: 40,
                backgroundColor: discoverGmail.isSuccess ? "#EBF5EE" : "#F0EDFF",
              }}
            >
              {discoverGmail.isSuccess ? (
                <Check className="h-5 w-5 text-[#4A8C5E]" />
              ) : (
                <Sparkles className="h-5 w-5 text-[#6366F1]" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h3
                className="text-[14px] font-semibold text-[#1A1A1A]"
                style={{ letterSpacing: "-0.02em" }}
              >
                {discoverGmail.isSuccess
                  ? "Discovery complete"
                  : "Discover contacts from Gmail"}
              </h3>

              {discoverGmail.isSuccess && discoverGmail.data ? (
                <div className="mt-1.5 space-y-1">
                  <p className="text-[12px] text-[#7B8189]">
                    Scanned <span className="font-medium text-[#4A4E54]">{discoverGmail.data.totalEmails}</span> emails
                    {" "}&middot; found <span className="font-medium text-[#4A4E54]">{discoverGmail.data.peopleFound}</span> people
                  </p>
                  {(discoverGmail.data.contactsCreated > 0 || discoverGmail.data.interactionsLogged > 0) ? (
                    <p className="text-[12px] text-[#7B8189]">
                      Created <span className="font-medium text-[#4A8C5E]">{discoverGmail.data.contactsCreated}</span> new contacts
                      {" "}&middot; logged <span className="font-medium text-[#4A8C5E]">{discoverGmail.data.interactionsLogged}</span> new interactions
                      {discoverGmail.data.contactsCleaned > 0 && (
                        <>
                          {" "}&middot; removed <span className="font-medium text-[#BF5040]">{discoverGmail.data.contactsCleaned}</span> non-personal
                        </>
                      )}
                    </p>
                  ) : discoverGmail.data.contactsCleaned > 0 ? (
                    <p className="text-[12px] text-[#7B8189]">
                      Removed <span className="font-medium text-[#BF5040]">{discoverGmail.data.contactsCleaned}</span> business/spam contacts.
                      {" "}{discoverGmail.data.contactsExisted} real contacts already synced.
                    </p>
                  ) : (
                    <p className="text-[12px] text-[#9BA1A8]">
                      All {discoverGmail.data.contactsExisted} contacts and {discoverGmail.data.interactionsExisted} interactions were already synced.
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-0.5 text-[12px] leading-relaxed text-[#9BA1A8]">
                  Scan your last 3 months of email to automatically create contacts
                  from everyone you&apos;ve been talking to and log all interactions.
                </p>
              )}

              {!discoverGmail.isSuccess && (
                <button
                  onClick={() => discoverGmail.mutate()}
                  disabled={discoverGmail.isPending}
                  className="mt-3 inline-flex items-center gap-2 rounded-[10px] bg-[#1A1A1A] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#2D2D2D] disabled:opacity-50"
                >
                  {discoverGmail.isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Scanning Gmail...
                    </>
                  ) : (
                    <>
                      <Mail className="h-3.5 w-3.5" />
                      Discover contacts
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Apple Contacts ── */}
      <div className="mt-3 rounded-[14px] border border-[#E8EAED] bg-white px-5 py-5">
        <div className="flex items-start gap-4">
          <div
            className="flex shrink-0 items-center justify-center rounded-[12px]"
            style={{
              width: 40,
              height: 40,
              backgroundColor: importApple.isSuccess ? "#EBF5EE" : "#F3F4F6",
            }}
          >
            {importApple.isSuccess ? (
              <Check className="h-5 w-5 text-[#4A8C5E]" />
            ) : (
              <Smartphone className="h-5 w-5 text-[#7B8189]" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h3
              className="text-[14px] font-semibold text-[#1A1A1A]"
              style={{ letterSpacing: "-0.02em" }}
            >
              {importApple.isSuccess
                ? "Apple Contacts imported"
                : "Apple Contacts"}
            </h3>

            {importApple.isSuccess && importApple.data ? (
              <div className="mt-1.5">
                <p className="text-[12px] text-[#7B8189]">
                  {(importApple.data.created > 0 || importApple.data.enriched > 0) ? (
                    <>
                      {importApple.data.created > 0 && (
                        <>Created <span className="font-medium text-[#4A8C5E]">{importApple.data.created}</span> contacts</>
                      )}
                      {importApple.data.created > 0 && importApple.data.enriched > 0 && <> &middot; </>}
                      {importApple.data.enriched > 0 && (
                        <>Enriched <span className="font-medium text-[#6366F1]">{importApple.data.enriched}</span> existing contacts with phone/address</>
                      )}
                      {importApple.data.skipped > 0 && (
                        <> &middot; <span className="text-[#9BA1A8]">{importApple.data.skipped} unchanged</span></>
                      )}
                    </>
                  ) : (
                    <>All {importApple.data.total} contacts already synced.</>
                  )}
                </p>
              </div>
            ) : (
              <p className="mt-0.5 text-[12px] leading-relaxed text-[#9BA1A8]">
                One-click import from your Mac&apos;s Contacts app. No file export needed.
              </p>
            )}

            {!importApple.isSuccess && (
              <button
                onClick={() => importApple.mutate()}
                disabled={importApple.isPending}
                className="mt-3 inline-flex items-center gap-2 rounded-[10px] bg-[#1A1A1A] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#2D2D2D] disabled:opacity-50"
              >
                {importApple.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Reading Contacts...
                  </>
                ) : (
                  <>
                    <Smartphone className="h-3.5 w-3.5" />
                    Import Apple Contacts
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── iMessage ── */}
      <div className="mt-3 rounded-[14px] border border-[#E8EAED] bg-white px-5 py-5">
        <div className="flex items-start gap-4">
          <div
            className="flex shrink-0 items-center justify-center rounded-[12px]"
            style={{
              width: 40,
              height: 40,
              backgroundColor: syncIMessage.isSuccess ? "#EBF5EE" : "#F0FFF4",
            }}
          >
            {syncIMessage.isSuccess ? (
              <Check className="h-5 w-5 text-[#4A8C5E]" />
            ) : (
              <MessageCircle className="h-5 w-5 text-[#34C759]" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h3
              className="text-[14px] font-semibold text-[#1A1A1A]"
              style={{ letterSpacing: "-0.02em" }}
            >
              {syncIMessage.isSuccess
                ? "iMessage synced"
                : "iMessage"}
            </h3>

            {syncIMessage.isSuccess && syncIMessage.data ? (
              <div className="mt-1.5">
                <p className="text-[12px] text-[#7B8189]">
                  {(syncIMessage.data.interactionsLogged > 0 || syncIMessage.data.contactsMatched > 0) ? (
                    <>
                      {syncIMessage.data.contactsMatched > 0 && (
                        <>Matched <span className="font-medium text-[#4A8C5E]">{syncIMessage.data.contactsMatched}</span> contacts</>
                      )}
                      {syncIMessage.data.contactsMatched > 0 && syncIMessage.data.interactionsLogged > 0 && <> &middot; </>}
                      {syncIMessage.data.interactionsLogged > 0 && (
                        <>Logged <span className="font-medium text-[#6366F1]">{syncIMessage.data.interactionsLogged}</span> conversations</>
                      )}
                    </>
                  ) : (
                    <>Scanned {syncIMessage.data.conversationsScanned} conversations — all already synced.</>
                  )}
                </p>
              </div>
            ) : (
              <p className="mt-0.5 text-[12px] leading-relaxed text-[#9BA1A8]">
                Sync your iMessage and SMS conversations. Matches messages to contacts by phone number.
              </p>
            )}

            {!syncIMessage.isSuccess && (
              <button
                onClick={() => syncIMessage.mutate()}
                disabled={syncIMessage.isPending}
                className="mt-3 inline-flex items-center gap-2 rounded-[10px] bg-[#1A1A1A] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#2D2D2D] disabled:opacity-50"
              >
                {syncIMessage.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Scanning Messages...
                  </>
                ) : (
                  <>
                    <MessageCircle className="h-3.5 w-3.5" />
                    Sync iMessages
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-1">
        {data.sources.map((source) => (
          <div
            key={source.key}
            className="flex items-center gap-3 rounded-[12px] px-4 py-3 transition-colors hover:bg-[#F7F7F8]"
          >
            <StatusDot status={source.status} />

            <div className="min-w-0 flex-1">
              <span className="text-[14px] font-medium text-[#1A1A1A]">
                {source.name}
              </span>
              <div className="flex items-center gap-2 text-[12px] text-[#C1C5CA]">
                <span>{source.captured}</span>
                {source.lastSync && (
                  <>
                    <span>&middot;</span>
                    <span>{formatRelativeTime(source.lastSync)}</span>
                  </>
                )}
              </div>
            </div>

            <SourceAction
              source={source}
              isSyncing={
                (source.key === "gmail" && syncGmail.isPending) ||
                (source.key === "google-contacts" && importContacts.isPending) ||
                (source.key === "google-calendar" && syncCalendar.isPending) ||
                (source.key === "imessage" && syncIMessage.isPending)
              }
              onSync={() => handleSync(source.key)}
              hasGoogleOAuth={data.hasGoogleOAuth}
            />
          </div>
        ))}
      </div>

      {/* ── Coverage Stats ── */}
      <div className="mt-8">
        <h3
          className="text-[14px] font-semibold text-[#1A1A1A]"
          style={{ letterSpacing: "-0.02em" }}
        >
          Coverage
        </h3>

        <div className="mt-3 space-y-2.5">
          {data.coverage.map((stat) => (
            <div key={stat.key} className="flex items-center gap-3">
              <CoverageBar current={stat.current} total={stat.total} />
              <span className="text-[13px] text-[#2A2D32]">
                <span className="font-medium">{stat.current}</span>
                <span className="text-[#C1C5CA]"> of {stat.total} </span>
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Gap Analysis ── */}
      {(zeroCount > 0 || unmatchedCount > 0) && (
        <div className="mt-8">
          <h3
            className="text-[14px] font-semibold text-[#1A1A1A]"
            style={{ letterSpacing: "-0.02em" }}
          >
            Gaps
          </h3>

          {/* Unmatched senders from Gmail */}
          {unmatchedCount > 0 && (
            <div className="mt-3">
              <button
                className="flex w-full items-center gap-2 text-left"
                onClick={() => setShowUnmatched((prev) => !prev)}
              >
                <span className="text-[13px] font-medium text-[#2A2D32]">
                  Unmatched email senders
                </span>
                <span className="rounded-md bg-[#FBF5E8] px-1.5 py-0.5 text-[11px] font-medium text-[#C4962E]">
                  {unmatchedCount}
                </span>
                <ChevronDown
                  className="ml-auto h-3.5 w-3.5 text-[#C1C5CA] transition-transform"
                  style={{
                    transform: showUnmatched ? "rotate(180deg)" : "rotate(0)",
                  }}
                />
              </button>
              <p className="mt-0.5 text-[12px] text-[#B5BAC0]">
                People emailing you who aren&apos;t in your contacts yet.
              </p>

              {showUnmatched && (
                <div className="crm-stagger mt-2 space-y-0.5">
                  {data.unmatchedSenders.map((sender) => (
                    <div
                      key={sender.email}
                      className="flex items-center gap-3 rounded-[10px] px-3 py-2 transition-colors hover:bg-[#F7F7F8]"
                    >
                      <div
                        className="flex shrink-0 items-center justify-center text-[11px] font-semibold text-[#C4962E]"
                        style={{
                          width: 28,
                          height: 28,
                          backgroundColor: "#FBF5E8",
                          borderRadius: 28 * 0.38,
                        }}
                      >
                        @
                      </div>

                      <div className="min-w-0 flex-1">
                        <span className="text-[13px] font-medium text-[#2A2D32]">
                          {sender.email}
                        </span>
                        <div className="text-[11px] text-[#C1C5CA]">
                          {sender.count} email{sender.count !== 1 ? "s" : ""}
                        </div>
                      </div>

                      <a
                        href={`/people?new=true&email=${encodeURIComponent(sender.email)}`}
                        className="flex items-center gap-1 rounded-md bg-[#F3F4F6] px-2 py-1 text-[11px] font-medium text-[#7B8189] transition-colors hover:bg-[#EDEEF0] hover:text-[#4A4E54]"
                      >
                        <UserPlus className="h-3 w-3" />
                        Add
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Contacts with zero interactions */}
          {zeroCount > 0 && (
            <div className={unmatchedCount > 0 ? "mt-5" : "mt-3"}>
              <button
                className="flex w-full items-center gap-2 text-left"
                onClick={() => setShowZeroContacts((prev) => !prev)}
              >
                <span className="text-[13px] font-medium text-[#2A2D32]">
                  Contacts with no interactions
                </span>
                <span className="rounded-md bg-[#FAEAE7] px-1.5 py-0.5 text-[11px] font-medium text-[#BF5040]">
                  {zeroCount}
                </span>
                <ChevronDown
                  className="ml-auto h-3.5 w-3.5 text-[#C1C5CA] transition-transform"
                  style={{
                    transform: showZeroContacts
                      ? "rotate(180deg)"
                      : "rotate(0)",
                  }}
                />
              </button>
              <p className="mt-0.5 text-[12px] text-[#B5BAC0]">
                Not captured by any sync. Add their email or phone to start
                tracking.
              </p>

              {showZeroContacts && (
                <div className="crm-stagger mt-2 space-y-0.5">
                  {data.zeroInteractionContacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="flex items-center gap-3 rounded-[10px] px-3 py-2 transition-colors hover:bg-[#F7F7F8]"
                    >
                      <div
                        className="flex shrink-0 items-center justify-center text-[11px] font-semibold text-[#C8CDD3]"
                        style={{
                          width: 28,
                          height: 28,
                          backgroundColor: "#F3F4F6",
                          borderRadius: 28 * 0.38,
                        }}
                      >
                        {contact.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 2)}
                      </div>

                      <div className="min-w-0 flex-1">
                        <span className="text-[13px] font-medium text-[#2A2D32]">
                          {contact.name}
                        </span>
                        <div className="flex items-center gap-1.5 text-[11px] text-[#C1C5CA]">
                          {contact.company && <span>{contact.company}</span>}
                          {contact.company && contact.email && (
                            <span>&middot;</span>
                          )}
                          {contact.email && <span>{contact.email}</span>}
                          {!contact.email && (
                            <span className="text-[#BF5040]">No email</span>
                          )}
                        </div>
                      </div>

                      <a
                        href={`/people?edit=${contact.id}`}
                        className="flex items-center gap-1 rounded-md bg-[#F3F4F6] px-2 py-1 text-[11px] font-medium text-[#7B8189] transition-colors hover:bg-[#EDEEF0] hover:text-[#4A4E54]"
                      >
                        <UserPlus className="h-3 w-3" />
                        Edit
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
