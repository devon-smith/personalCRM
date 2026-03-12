"use client";

import { useState, useEffect } from "react";
import { NavMenu } from "@/components/dashboard/sidebar";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { QuickLogPicker } from "@/components/interactions/quick-log-picker";
import { DraftComposer } from "@/components/draft-composer";
import { DraftComposerProvider, useDraftComposer } from "@/lib/draft-composer-context";
import { useAutoSync } from "@/lib/hooks/use-auto-sync";
import { Search } from "lucide-react";

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
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--background)" }}>
      <header
        className="sticky top-0 z-40 flex h-14 items-center justify-between px-4"
        style={{ backgroundColor: "var(--background)" }}
      >
        <NavMenu />

        <button
          className="flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-1.5 text-sm transition-colors"
          style={{ color: "var(--text-tertiary)" }}
          onClick={() => setSearchOpen(true)}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search</span>
          <kbd
            className="pointer-events-none hidden rounded-[var(--radius-sm)] px-1.5 text-[10px] font-medium sm:inline"
            style={{ backgroundColor: "var(--surface-sunken)", color: "var(--text-tertiary)" }}
          >
            ⌘K
          </kbd>
        </button>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-[600px] px-5 pb-12">{children}</div>
      </main>

      <CommandPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onQuickLog={() => setQuickLogOpen(true)}
      />
      <QuickLogPicker
        open={quickLogOpen}
        onOpenChange={setQuickLogOpen}
      />
      <DraftComposer />
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <DraftComposerProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </DraftComposerProvider>
  );
}
