import { useEffect, useRef, useCallback, type MutableRefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";

const SYNC_INTERVAL = 5 * 60 * 1000; // Browser fallback; worker runs every 3 minutes.
const FRESH_GMAIL_SYNC_MS = 4.5 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BROWSER_SYNC_LOCK_KEY = "personal-crm:browser-sync-lock";
const BROWSER_SYNC_LOCK_TTL_MS = 2 * 60 * 1000;

/**
 * Local dev keeps browser fallback sync on for convenience. Production
 * defaults to worker-mode because the Graphile Worker owns Gmail and
 * Calendar freshness without one poller per open tab.
 *
 * Public env vars because this hook runs client-side:
 * - NEXT_PUBLIC_ENABLE_BROWSER_SYNC=true opts production back into the
 *   fallback while the worker is being brought online.
 * - NEXT_PUBLIC_DISABLE_BROWSER_SYNC=true force-disables the hook in
 *   any environment.
 */
const BROWSER_SYNC_DISABLED =
  process.env.NEXT_PUBLIC_DISABLE_BROWSER_SYNC === "true" ||
  (process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_ENABLE_BROWSER_SYNC !== "true");

/**
 * Automatically syncs Gmail as a stale browser fallback.
 *
 * - Gmail: syncs only when the DB says the worker/browser sync is stale
 *
 * All syncs are idempotent and deduplicate. Backs off after consecutive failures.
 *
 * No-op in production by default, or when
 * NEXT_PUBLIC_DISABLE_BROWSER_SYNC=true — server-side worker handles
 * everything in that mode.
 */
export function useAutoSync() {
  const queryClient = useQueryClient();
  const syncingRef = useRef(false);
  const failureCountRef = useRef(0);
  const lockOwnerRef = useRef<string | null>(null);

  const runGmailSync = useCallback(async () => {
    if (!isVisibleDocument()) return;
    if (syncingRef.current) return;
    if (failureCountRef.current >= MAX_CONSECUTIVE_FAILURES) return;

    const lockOwner = getLockOwner(lockOwnerRef);
    if (!acquireBrowserSyncLock(lockOwner)) return;
    syncingRef.current = true;

    try {
      const shouldSync = await shouldRunGmailSync();
      if (!shouldSync) {
        failureCountRef.current = 0;
        return;
      }

      const res = await fetch("/api/gmail/sync?trigger=browser_fallback", {
        method: "POST",
      });

      if (!res.ok) {
        failureCountRef.current += 1;
        return;
      }

      failureCountRef.current = 0;

      const data = (await res.json()) as { processed?: number };
      const processed = Number(data.processed ?? 0);

      queryClient.invalidateQueries({ queryKey: ["data-health"] });
      queryClient.invalidateQueries({ queryKey: ["source-status", "google"] });

      if (processed > 0) {
        queryClient.invalidateQueries({ queryKey: ["contacts"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
      }

      // Classification is now driven by the inbox-classify worker
      // task (enqueued from onInboundInteraction in src/lib/inbox.ts),
      // not a client-side POST. The query above will repick up new
      // InboxItem rows; their needsResponse fields populate within a
      // worker poll interval.
    } catch {
      failureCountRef.current += 1;
    } finally {
      syncingRef.current = false;
      releaseBrowserSyncLock(lockOwner);
    }
  }, [queryClient]);

  useEffect(() => {
    // Bail entirely when the server-side worker is the source of truth.
    // Avoids redundant requests + lets the user keep tabs open without
    // a per-tab sync timer racing the worker.
    if (BROWSER_SYNC_DISABLED) return;

    // Run Gmail sync after 3s, then periodically as a stale fallback.
    const initialTimer = setTimeout(runGmailSync, 3000);
    const gmailInterval = setInterval(runGmailSync, SYNC_INTERVAL);

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        failureCountRef.current = 0;
        runGmailSync();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(gmailInterval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [runGmailSync]);
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

function isVisibleDocument(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

function getLockOwner(ownerRef: MutableRefObject<string | null>): string {
  ownerRef.current ??=
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return ownerRef.current;
}

function acquireBrowserSyncLock(owner: string): boolean {
  if (typeof window === "undefined") return true;

  try {
    const now = Date.now();
    const raw = window.localStorage.getItem(BROWSER_SYNC_LOCK_KEY);
    if (raw) {
      const lock = JSON.parse(raw) as { owner?: string; expiresAt?: number };
      if (
        lock.owner &&
        lock.owner !== owner &&
        typeof lock.expiresAt === "number" &&
        lock.expiresAt > now
      ) {
        return false;
      }
    }

    window.localStorage.setItem(
      BROWSER_SYNC_LOCK_KEY,
      JSON.stringify({ owner, expiresAt: now + BROWSER_SYNC_LOCK_TTL_MS }),
    );

    const confirmed = JSON.parse(
      window.localStorage.getItem(BROWSER_SYNC_LOCK_KEY) ?? "{}",
    ) as { owner?: string };
    return confirmed.owner === owner;
  } catch {
    return true;
  }
}

function releaseBrowserSyncLock(owner: string): void {
  if (typeof window === "undefined") return;

  try {
    const raw = window.localStorage.getItem(BROWSER_SYNC_LOCK_KEY);
    if (!raw) return;
    const lock = JSON.parse(raw) as { owner?: string };
    if (lock.owner === owner) {
      window.localStorage.removeItem(BROWSER_SYNC_LOCK_KEY);
    }
  } catch {
    // Storage can be unavailable in some private/mobile contexts.
  }
}
