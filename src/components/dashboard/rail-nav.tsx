"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Users,
  CircleDot,
  Activity,
  Settings,
  Merge,
  Search,
  Wrench,
  ChevronRight,
} from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { DataHealthResponse } from "@/app/api/data-health/route";

interface RailItem {
  href: string;
  label: string;
  icon: typeof Home;
  group: "general" | "tools";
  matchExact?: boolean;
}

const ITEMS: RailItem[] = [
  { href: "/dashboard",   label: "Home",         icon: Home,     group: "general", matchExact: true },
  { href: "/activity",    label: "Activity",     icon: Activity, group: "general" },
  { href: "/people",      label: "People",       icon: Users,    group: "general" },
  { href: "/circles",     label: "Circles",      icon: CircleDot, group: "general" },
  { href: "/merge",       label: "Merge",        icon: Merge,    group: "tools" },
  { href: "/admin/jobs",  label: "Admin",        icon: Wrench,   group: "tools" },
  { href: "/settings",    label: "Settings",     icon: Settings, group: "tools" },
];

/**
 * Persistent left navigation rail — desktop only (sm+). Mobile keeps
 * the existing bottom nav. Warm-charcoal background, grouped sections,
 * search pill at the top, current-page treatment is a single thin
 * vertical accent line + brighter label.
 */
export function RailNav({ onOpenSearch }: { onOpenSearch: () => void }) {
  const pathname = usePathname();
  const general = ITEMS.filter((i) => i.group === "general");
  const tools = ITEMS.filter((i) => i.group === "tools");

  // Integrations now lives inside Settings, so the terracotta reconnect
  // dot rides the Settings item. Same query the banner uses; React Query
  // dedups the network hit.
  const { data: dataHealth } = useQuery<DataHealthResponse>({
    queryKey: ["data-health"],
    queryFn: async () => {
      const res = await fetch("/api/data-health");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const settingsHasIssue =
    (dataHealth?.googleAccounts.filter((a) => a.needsReconnect).length ?? 0) > 0;

  return (
    <aside
      className="hidden sm:flex flex-col shrink-0 sticky top-0"
      style={{
        width: 232,
        // Hex values, not CSS vars — see Surface for the same reasoning.
        backgroundColor: "#1B1A17",
        color: "#E8E4DC",
        height: "100vh",
      }}
    >
      {/* Wordmark */}
      <div className="px-5 pt-6 pb-4">
        <div className="ds-display-md" style={{ color: "#FAF8F5", fontSize: "1.125rem" }}>
          ProfessorCRM
        </div>
      </div>

      {/* Search pill */}
      <div className="px-4 pb-5">
        <button
          onClick={onOpenSearch}
          className="flex w-full items-center gap-2 rounded-full px-3 py-1.5 text-left"
          style={{
            backgroundColor: "rgba(232,228,220,0.08)",
            color: "#8C8A82",
            transition: "background-color var(--duration-fast) var(--ease-default)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(232,228,220,0.14)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(232,228,220,0.08)";
          }}
        >
          <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.6} />
          <span className="flex-1 text-[12.5px]">Search</span>
          <kbd
            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ backgroundColor: "rgba(232,228,220,0.08)", color: "#8C8A82" }}
          >
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-3">
        <RailGroup label="General" items={general} pathname={pathname} />
        <div className="h-4" />
        <RailGroup
          label="Tools"
          items={tools}
          pathname={pathname}
          statusDots={settingsHasIssue ? { "/settings": "urgent" } : undefined}
        />
      </nav>

      {/* User chip pinned bottom */}
      <div className="px-3 pb-4 pt-3" style={{ borderTop: "1px solid rgba(232,228,220,0.08)" }}>
        <RailUserChip />
      </div>
    </aside>
  );
}

function RailUserChip() {
  const { data: session } = useSession();
  const user =
    session?.user ??
    (process.env.NODE_ENV === "development" ? { name: "User", email: "user@example.com", image: null } : null);
  if (!user) return null;
  const initials = (user.name ?? user.email ?? "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarImage src={user.image ?? undefined} alt={user.name ?? "User"} />
        <AvatarFallback
          className="text-[11px] font-semibold"
          style={{ backgroundColor: "rgba(232,228,220,0.14)", color: "#FAF8F5" }}
        >
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium" style={{ color: "#FAF8F5" }}>
          {user.name}
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-[11px] transition-colors"
          style={{ color: "#8C8A82" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#E8E4DC";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "#8C8A82";
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function RailGroup({
  label,
  items,
  pathname,
  statusDots,
}: {
  label: string;
  items: RailItem[];
  pathname: string;
  /** Per-href dot color. "urgent" → terracotta. */
  statusDots?: Record<string, "urgent">;
}) {
  return (
    <div>
      <div
        className="px-3 pb-2 text-[10.5px] uppercase tracking-[0.1em] font-semibold"
        style={{ color: "#8C8A82" }}
      >
        {label}
      </div>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = item.matchExact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          const dot = statusDots?.[item.href];
          return (
            <li key={item.href} className="relative">
              {active ? (
                <span
                  aria-hidden
                  className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r"
                  style={{ backgroundColor: "#FAF8F5" }}
                />
              ) : null}
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-full pl-3 pr-3 py-1.5 transition-colors",
                  "text-[13px]",
                )}
                style={{
                  color: active ? "#FAF8F5" : "#E8E4DC",
                  fontWeight: active ? 600 : 400,
                  transitionDuration: "var(--duration-fast)",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = "#FAF8F5";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.color = "#E8E4DC";
                }}
              >
                <Icon className="h-[15px] w-[15px]" strokeWidth={1.6} />
                <span className="flex-1">{item.label}</span>
                {dot === "urgent" ? (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: "var(--status-urgent)" }}
                  />
                ) : null}
                {active ? (
                  <ChevronRight className="h-3 w-3 shrink-0 opacity-60" strokeWidth={1.6} />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
