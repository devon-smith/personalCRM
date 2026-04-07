import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

const SYNC_INTERVAL = 2 * 60 * 1000; // 2 minutes
const MAX_CONSECUTIVE_FAILURES = 3;

async function runClassify() {
  try {
    await fetch("/api/inbox-items/classify", { method: "POST" });
  } catch {
    // classification is non-blocking — ignore failures
  }
}

/**
 * Automatically syncs data sources.
 *
 * - Gmail: syncs on mount, every 2 minutes, and on tab focus
 * - Google Contacts, Calendar: sync once on mount
 *
 * All syncs are idempotent and deduplicate. Backs off after consecutive failures.
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

      // Classify any new unclassified inbox items, then refresh
      runClassify().then(() => {
        queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
      });
    } catch {
      failureCountRef.current += 1;
    } finally {
      syncingRef.current = false;
    }
  }, [queryClient]);

  const runFullSync = useCallback(async () => {
    if (didInitialFullSync.current) return;
    didInitialFullSync.current = true;

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

    queryClient.invalidateQueries({ queryKey: ["contacts"] });
    queryClient.invalidateQueries({ queryKey: ["data-health"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
    queryClient.invalidateQueries({ queryKey: ["inbox-items"] });

    // Classify after all syncs complete
    runClassify().then(() => {
      queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
    });
  }, [queryClient]);

  useEffect(() => {
    // Run Gmail sync after 3s, then every 2 minutes
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
