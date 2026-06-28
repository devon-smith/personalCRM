"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { RailNav } from "@/components/dashboard/rail-nav";
import { RouteTransition } from "@/components/dashboard/route-transition";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { QuickLogPicker } from "@/components/interactions/quick-log-picker";
import { DraftComposer } from "@/components/draft-composer";
import { ReconnectBanner } from "@/components/integrations/reconnect-banner";
import { DraftComposerProvider, useDraftComposer } from "@/lib/draft-composer-context";
import { useAutoSync } from "@/lib/hooks/use-auto-sync";
import {
  Search,
  Users,
  Home,
  MessageCircleQuestion,
  Inbox as InboxIcon,
  CircleDot,
  MoreHorizontal,
  X,
  MessageSquareText,
  Merge,
  Wrench,
  Settings,
  Activity,
} from "lucide-react";

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const { openComposer } = useDraftComposer();
  useAutoSync();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "l") {
        e.preventDefault();
        setQuickLogOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();
        openComposer();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [openComposer]);

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      {/* Persistent left rail — desktop only */}
      <RailNav onOpenSearch={() => setSearchOpen(true)} />

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <ReconnectBanner />

        {/* Mobile-only header: wordmark + search pill. Burger menu was
            retired in M0.x.16 — bottom nav + "More" sheet cover every
            destination, so the burger was duplicative. The header pads
            its top by the safe-area inset so it clears the notch in the
            Capacitor shell (M0.x.17). */}
        <header
          className="sticky top-0 z-40 flex items-center justify-between px-4 sm:hidden"
          style={{
            backgroundColor: "var(--background)",
            paddingTop: "var(--safe-top)",
            height: "calc(3.5rem + var(--safe-top))",
          }}
        >
          <span
            className="ds-display-md"
            style={{ fontSize: "1rem", color: "var(--text-primary)" }}
          >
            ProfessorCRM
          </span>
          <button
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors"
            style={{
              color: "var(--text-tertiary)",
              backgroundColor: "var(--surface-sunken)",
              minHeight: 36,
            }}
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search</span>
          </button>
        </header>

        <main className="flex-1">
          <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-8 lg:px-10 py-6 sm:py-10 pb-24 sm:pb-12">
            <RouteTransition>{children}</RouteTransition>
          </div>
        </main>

        {/* Mobile bottom nav — visible below 640px */}
        <MobileBottomNav />
      </div>

      <CommandPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onQuickLog={() => setQuickLogOpen(true)}
      />
      <QuickLogPicker open={quickLogOpen} onOpenChange={setQuickLogOpen} />
      <DraftComposer />
    </div>
  );
}

/**
 * M0.x.16 — Mobile bottom nav covers all 9 rail destinations via 4
 * primary items + a "More" sheet. Primary items are the highest-
 * traffic Generals (Home, Replies, Ask, People); the More sheet holds
 * the rest (Circles, plus the Tools group: Voice, Merge, Admin,
 * Settings). Activity is surfaced in More.
 */
const PRIMARY_NAV: Array<{
  href: string;
  icon: typeof Home;
  label: string;
  matchExact?: boolean;
}> = [
  { href: "/dashboard", icon: Home, label: "Home", matchExact: true },
  { href: "/reply-queue", icon: InboxIcon, label: "Replies" },
  { href: "/ask", icon: MessageCircleQuestion, label: "Ask" },
  { href: "/people", icon: Users, label: "People" },
];

const MORE_NAV: Array<{
  href: string;
  icon: typeof Home;
  label: string;
}> = [
  { href: "/circles", icon: CircleDot, label: "Circles" },
  { href: "/activity", icon: Activity, label: "Activity" },
  { href: "/voice", icon: MessageSquareText, label: "Voice" },
  { href: "/merge", icon: Merge, label: "Merge" },
  { href: "/admin/jobs", icon: Wrench, label: "Admin" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

function MobileBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // Highlight the "More" tab when we're on any of its destinations.
  const onMorePath = MORE_NAV.some((m) =>
    m.href === pathname || pathname.startsWith(`${m.href}/`),
  );

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex sm:hidden"
        style={{
          height: 56,
          backgroundColor: "var(--background)",
          borderTop: "1px solid var(--border-subtle, #E8E6E1)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {PRIMARY_NAV.map((item) => {
          const isActive = item.matchExact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className="flex flex-1 flex-col items-center justify-center gap-0.5"
              style={{
                color: isActive ? "var(--text-primary)" : "var(--text-tertiary)",
                transition: "color 0.15s",
                minHeight: 44,
              }}
            >
              <Icon
                className="h-5 w-5"
                style={{ strokeWidth: isActive ? 2.5 : 1.5 }}
              />
              <span
                style={{
                  fontSize: 10,
                  fontWeight: isActive ? 600 : 500,
                  letterSpacing: "-0.01em",
                }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5"
          style={{
            color: onMorePath ? "var(--text-primary)" : "var(--text-tertiary)",
            transition: "color 0.15s",
            minHeight: 44,
          }}
          aria-label="More navigation"
        >
          <MoreHorizontal
            className="h-5 w-5"
            style={{ strokeWidth: onMorePath ? 2.5 : 1.5 }}
          />
          <span
            style={{
              fontSize: 10,
              fontWeight: onMorePath ? 600 : 500,
              letterSpacing: "-0.01em",
            }}
          >
            More
          </span>
        </button>
      </nav>

      {/* "More" sheet — covers the remaining destinations + sign-out
          link. Slides up from the bottom; tap backdrop to dismiss. */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-50 sm:hidden"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
          />
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-[20px] pt-2 pb-6"
            style={{
              backgroundColor: "var(--background)",
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="mx-auto mb-3 h-1 w-10 rounded-full" style={{ backgroundColor: "var(--border)" }} />
            <div className="flex items-center justify-between px-5 pb-3">
              <span className="ds-heading-md">More</span>
              <button
                onClick={() => setMoreOpen(false)}
                className="rounded-full p-1.5"
                style={{ color: "var(--text-tertiary)" }}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="px-2">
              {MORE_NAV.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-3 rounded-[10px] px-4 py-3"
                    style={{
                      color: isActive
                        ? "var(--text-primary)"
                        : "var(--text-secondary)",
                      backgroundColor: isActive
                        ? "var(--surface-sunken)"
                        : undefined,
                      minHeight: 48,
                    }}
                  >
                    <Icon className="h-5 w-5" />
                    <span
                      className="text-[15px]"
                      style={{ fontWeight: isActive ? 600 : 500 }}
                    >
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <DraftComposerProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </DraftComposerProvider>
  );
}
