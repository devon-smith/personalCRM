"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

interface GoogleSourceAccountStatus {
  email: string;
  needsReconnect: boolean;
}

interface GoogleSourceStatus {
  accounts: GoogleSourceAccountStatus[];
}

/**
 * A calm "needs reconnect" row. Terracotta on warm-paper, not a red
 * full-bleed klaxon. Sync paused until reconnected; the rail nav also
 * shows a small terracotta dot on Settings so the status is visible
 * from anywhere even when the banner isn't on screen.
 */
export function ReconnectBanner() {
  const { data } = useQuery<GoogleSourceStatus>({
    queryKey: ["source-status", "google"],
    queryFn: async () => {
      const res = await fetch("/api/source-status/google");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const broken = data?.accounts.filter((account) => account.needsReconnect) ?? [];
  if (broken.length === 0) return null;

  const label =
    broken.length === 1
      ? `${broken[0].email} disconnected`
      : `${broken.length} Google accounts disconnected`;

  return (
    <div
      role="alert"
      className="flex items-center gap-3 mx-4 sm:mx-8 lg:mx-10 mt-6 rounded-2xl px-5 py-3"
      style={{
        // Hex to dodge the same cascade-stale variable resolution that
        // bit the tone surfaces. Earth-terracotta, not pink-rust.
        backgroundColor: "#F0E5DC",
      }}
    >
      <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.7} style={{ color: "#7A4F3C" }} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium" style={{ color: "#7A4F3C" }}>{label}</p>
        <p className="text-[11.5px] mt-0.5" style={{ color: "#5A574F" }}>
          Sync paused until reconnected.
        </p>
      </div>
      <Link
        href="/integrations"
        className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
        style={{
          backgroundColor: "#2E2A24",
          color: "#FAF8F5",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "#1B1A17";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "#2E2A24";
        }}
      >
        Reconnect
      </Link>
    </div>
  );
}
