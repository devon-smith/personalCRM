"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { DataHealthResponse } from "@/app/api/data-health/route";

export function ReconnectBanner() {
  const { data } = useQuery<DataHealthResponse>({
    queryKey: ["data-health"],
    queryFn: async () => {
      const res = await fetch("/api/data-health");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    // Refetch periodically so we surface failures detected by background syncs.
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const broken = data?.googleAccounts.filter((a) => a.needsReconnect) ?? [];
  if (broken.length === 0) return null;

  const label =
    broken.length === 1
      ? `${broken[0].email} disconnected`
      : `${broken.length} Google accounts disconnected`;

  return (
    <div
      role="alert"
      className="flex items-center gap-3 px-4 py-2.5"
      style={{
        backgroundColor: "var(--status-error-bg, #FEF2F2)",
        borderBottom: "1px solid var(--status-error, #DC2626)",
        color: "var(--status-error, #991B1B)",
      }}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{label}</p>
        <p className="text-[11px] opacity-80">
          Sync paused until reconnected. Tokens expire after extended inactivity
          or when Google revokes them.
        </p>
      </div>
      <Link
        href="/integrations"
        className="shrink-0 rounded-[8px] px-3 py-1.5 text-[12px] font-medium"
        style={{
          backgroundColor: "var(--status-error, #DC2626)",
          color: "white",
        }}
      >
        Reconnect
      </Link>
    </div>
  );
}
