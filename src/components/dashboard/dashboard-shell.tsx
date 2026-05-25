"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { NavMenu } from "@/components/dashboard/sidebar";
import { RailNav } from "@/components/dashboard/rail-nav";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { QuickLogPicker } from "@/components/interactions/quick-log-picker";
import { DraftComposer } from "@/components/draft-composer";
import { ReconnectBanner } from "@/components/integrations/reconnect-banner";
import { DraftComposerProvider, useDraftComposer } from "@/lib/draft-composer-context";
import { useAutoSync } from "@/lib/hooks/use-auto-sync";
import { Search, Users, BarChart3 } from "lucide-react";

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

        {/* Mobile-only header: burger menu + search pill. Hidden sm+ because
            the rail subsumes both. */}
        <header
          className="sticky top-0 z-40 flex h-14 items-center justify-between px-4 sm:hidden"
          style={{ backgroundColor: "var(--background)" }}
        >
          <NavMenu />
          <button
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors"
            style={{
              color: "var(--text-tertiary)",
              backgroundColor: "var(--surface-sunken)",
            }}
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search</span>
          </button>
        </header>

        <main className="flex-1">
          <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-8 lg:px-10 py-6 sm:py-10 pb-20 sm:pb-12">
            {children}
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

const MOBILE_NAV_ITEMS: Array<{
  href: string;
  icon: typeof BarChart3;
  label: string;
  matchExact?: boolean;
}> = [
  { href: "/dashboard", icon: BarChart3, label: "Home", matchExact: true },
  { href: "/people", icon: Users, label: "Contacts" },
];

function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex sm:hidden"
      style={{
        height: 56,
        backgroundColor: "var(--background)",
        borderTop: "1px solid var(--border-subtle, #E8E6E1)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {MOBILE_NAV_ITEMS.map((item) => {
        const isActive = item.matchExact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={item.href}
            className="flex flex-1 flex-col items-center justify-center gap-0.5"
            style={{
              color: isActive ? "var(--accent-color, #1A1A1A)" : "var(--text-tertiary)",
              transition: "color 0.15s",
              minHeight: 44,
            }}
          >
            <Icon
              className="h-5 w-5"
              style={{
                strokeWidth: isActive ? 2.5 : 1.5,
              }}
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
    </nav>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <DraftComposerProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </DraftComposerProvider>
  );
}
