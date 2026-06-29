"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { patchCircleMetadataCaches } from "@/lib/hooks/use-circles";

interface GoogleSyncToggleProps {
  circleId: string;
  enabled: boolean;
  syncedAt: string | null;
  error: string | null;
}

interface CircleSyncStateResponse {
  id?: string;
  circleId?: string;
  googleSyncEnabled?: boolean;
  googleSyncedAt?: string | null;
  googleSyncError?: string | null;
}

/**
 * One-button control for "push this circle to Google as a contact
 * group". Three states:
 *   - off: button reads "Sync to Google" → enables + immediately runs
 *   - on, syncing: spinner
 *   - on, last-synced: tooltip-style timestamp + click triggers a
 *     fresh sync
 *
 * Errors are sticky on the circle row (red badge with the message)
 * until the next successful sync clears them.
 */
export function GoogleSyncToggle({
  circleId,
  enabled,
  syncedAt,
  error,
}: GoogleSyncToggleProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const enableAndSync = useCallback(async () => {
    setBusy(true);
    let syncAttempted = enabled;
    try {
      // Enable first if needed
      if (!enabled) {
        const patch = await fetch(`/api/circles/${circleId}/google-sync`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        });
        if (!patch.ok) {
          const e = await patch.json().catch(() => ({}));
          throw new Error(e.error ?? "Couldn't enable sync");
        }
        const patchResult = (await patch.json().catch(() => ({}))) as CircleSyncStateResponse;
        patchCircleSyncState(queryClient, circleId, patchResult);
      }
      // Trigger sync
      syncAttempted = true;
      const sync = await fetch(`/api/circles/${circleId}/google-sync`, {
        method: "POST",
      });
      const result = await sync.json().catch(() => ({}));
      if (!sync.ok) throw new Error(result.error ?? "Sync failed");
      patchCircleSyncState(queryClient, circleId, result as CircleSyncStateResponse);

      const parts: string[] = [];
      if (typeof result.added === "number") parts.push(`+${result.added}`);
      if (typeof result.removed === "number") parts.push(`-${result.removed}`);
      if (typeof result.unresolved === "number" && result.unresolved > 0) {
        parts.push(`${result.unresolved} unresolved`);
      }
      toast.success(`Synced to Google ${parts.join(" ")}`.trim());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      toast.error(message);
      if (syncAttempted) {
        patchCircleMetadataCaches(queryClient, {
          id: circleId,
          googleSyncEnabled: true,
          googleSyncedAt: null,
          googleSyncError: message,
        });
      }
    } finally {
      setBusy(false);
    }
  }, [circleId, enabled, queryClient]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/circles/${circleId}/google-sync`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      if (!res.ok) throw new Error("Couldn't disable sync");
      const result = (await res.json().catch(() => ({}))) as CircleSyncStateResponse;
      patchCircleSyncState(queryClient, circleId, result);
      toast("Google sync turned off");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }, [circleId, queryClient]);

  if (busy) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px]"
        style={{ color: "var(--text-tertiary)" }}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Syncing…
      </span>
    );
  }

  if (error) {
    return (
      <button
        type="button"
        onClick={enableAndSync}
        title={error}
        className="inline-flex items-center gap-1 text-[11px] font-medium"
        style={{ color: "var(--status-error, #DC2626)" }}
      >
        <AlertTriangle className="h-3 w-3" />
        Sync failed · retry
      </button>
    );
  }

  if (enabled && syncedAt) {
    return (
      <span
        className="inline-flex items-center gap-2 text-[11px]"
        style={{ color: "var(--text-tertiary)" }}
      >
        <Check className="h-3 w-3" style={{ color: "var(--status-success, #16a34a)" }} />
        Synced {formatRelative(syncedAt)}
        <button
          type="button"
          onClick={enableAndSync}
          className="underline"
          style={{ color: "var(--text-secondary)" }}
        >
          resync
        </button>
        <button
          type="button"
          onClick={disable}
          className="underline"
          style={{ color: "var(--text-tertiary)" }}
        >
          off
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={enableAndSync}
      className="text-[11px] font-medium underline"
      style={{ color: "var(--text-secondary)" }}
    >
      Sync to Google
    </button>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function patchCircleSyncState(
  queryClient: ReturnType<typeof useQueryClient>,
  circleId: string,
  result: CircleSyncStateResponse,
) {
  patchCircleMetadataCaches(queryClient, {
    id: result.id ?? result.circleId ?? circleId,
    ...(result.googleSyncEnabled !== undefined && {
      googleSyncEnabled: result.googleSyncEnabled,
    }),
    ...(result.googleSyncedAt !== undefined && {
      googleSyncedAt: result.googleSyncedAt,
    }),
    ...(result.googleSyncError !== undefined && {
      googleSyncError: result.googleSyncError,
    }),
  });
}
