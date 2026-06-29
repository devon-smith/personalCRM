import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

const SYNC_INTERVAL = 5 * 60 * 1000; // Browser fallback; worker runs every 3 minutes.
const FRESH_GMAIL_SYNC_MS = 4.5 * 60 * 1000;
const FULL_SYNC_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const FULL_SYNC_STORAGE_KEY = "personal-crm:last-full-auto-sync-at";

/**
 * Browser-side sync is on by default. Once the Graphile Worker
 * (worker/) has been running reliably for a few days you can flip
 * NEXT_PUBLIC_DISABLE_BROWSER_SYNC=true in .env.local and redeploy to
 * make useAutoSync a no-op — the worker's gmail-sync / calendar-sync
 * tasks cover the same ground without depending on a browser tab
 * being open.
 *
 * Public env var because it has to be read client-side.
 */
const BROWSER_SYNC_DISABLED =
  process.env.NEXT_PUBLIC_DISABLE_BROWSER_SYNC === "true";

/**
 * Automatically syncs data sources.
 *
 * - Gmail: syncs only when the DB says the worker/browser sync is stale
 * - Google Contacts, Calendar: sync once per local cooldown window
 *
 * All syncs are idempotent and deduplicate. Backs off after consecutive failures.
 *
 * No-op when NEXT_PUBLIC_DISABLE_BROWSER_SYNC=true — server-side worker
 * handles everything in that mode.
 */
export function useAutoSync() {
  const queryClient = useQueryClient();
  const syncingRef = useRef(false);
  const failureCountRef = useRef(0);
  const didInitialFullSync = useRef(false);

  const runGmailSync = useCallback(async () => {
    if (syncingRef.current) return;
    if (failureCountRef.current >= MAX_CONSECUTIVE_FAILURES) return;

    syncingRef.current = true;

    try {
      const shouldSync = await shouldRunGmailSync();
      if (!shouldSync) {
        failureCountRef.current = 0;
        return;
      }

      const res = await fetch("/api/gmail/sync", { method: "POST" });

      if (!res.ok) {
        failureCountRef.current += 1;
        return;
      }

      failureCountRef.current = 0;

      const data = await res.json();

      queryClient.invalidateQueries({ queryKey: ["unresponded-threads"] });
      queryClient.invalidateQueries({ queryKey: ["data-health"] });

      if (data.processed > 0) {
        queryClient.invalidateQueries({ queryKey: ["contacts"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      }

      queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
      // Classification is now driven by the inbox-classify worker
      // task (enqueued from onInboundInteraction in src/lib/inbox.ts),
      // not a client-side POST. The query above will repick up new
      // InboxItem rows; their needsResponse fields populate within a
      // worker poll interval.
    } catch {
      failureCountRef.current += 1;
    } finally {
      syncingRef.current = false;
    }
  }, [queryClient]);

  const runFullSync = useCallback(async () => {
    if (didInitialFullSync.current) return;
    didInitialFullSync.current = true;
    if (!shouldRunFullSync()) return;

    // Fire all syncs in parallel — all are idempotent and deduplicate
    const syncs = [
      // Google Contacts
      fetch("/api/gmail/contacts")
        .then(async (res) => {
          if (!res.ok) return;
          const { contacts } = await res.json();
          if (!contacts || contacts.length === 0) return;
          return fetch("/api/gmail/contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contacts }),
          });
        })
        .catch(() => {}),

      // Google Calendar
      fetch("/api/calendar", { method: "POST" }).catch(() => {}),
    ];

    await Promise.allSettled(syncs);
    markFullSyncRan();

    queryClient.invalidateQueries({ queryKey: ["contacts"] });
    queryClient.invalidateQueries({ queryKey: ["data-health"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
    queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
  }, [queryClient]);

  useEffect(() => {
    // Bail entirely when the server-side worker is the source of truth.
    // Avoids redundant requests + lets the user keep tabs open without
    // a per-tab sync timer racing the worker.
    if (BROWSER_SYNC_DISABLED) return;

    // Run Gmail sync after 3s, then periodically as a stale fallback.
    const initialTimer = setTimeout(runGmailSync, 3000);
    const gmailInterval = setInterval(runGmailSync, SYNC_INTERVAL);

    // Run full sync (all sources) once after 5s
    const fullSyncTimer = setTimeout(runFullSync, 5000);

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        failureCountRef.current = 0;
        runGmailSync();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearTimeout(initialTimer);
      clearTimeout(fullSyncTimer);
      clearInterval(gmailInterval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [runGmailSync, runFullSync]);
}

async function shouldRunGmailSync(): Promise<boolean> {
  try {
    const res = await fetch("/api/gmail/sync", { cache: "no-store" });
    if (!res.ok) return true;
    const state = (await res.json()) as {
      synced?: boolean;
      syncEnabled?: boolean;
      lastSyncAt?: string | null;
    };

    if (state.synced && state.syncEnabled === false) return false;
    if (!state.lastSyncAt) return true;

    const lastSyncAt = new Date(state.lastSyncAt).getTime();
    if (!Number.isFinite(lastSyncAt)) return true;
    return Date.now() - lastSyncAt > FRESH_GMAIL_SYNC_MS;
  } catch {
    // If the cheap status read fails, preserve the previous fallback behavior.
    return true;
  }
}

function shouldRunFullSync(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(FULL_SYNC_STORAGE_KEY);
    if (!raw) return true;
    const last = Number(raw);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last > FULL_SYNC_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markFullSyncRan(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FULL_SYNC_STORAGE_KEY, String(Date.now()));
  } catch {
    // Storage can be unavailable in some private/mobile contexts.
  }
}
