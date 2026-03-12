"use client";

import { useState, useEffect } from "react";
import { NavMenu } from "@/components/dashboard/sidebar";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { QuickLogPicker } from "@/components/interactions/quick-log-picker";
import { Search } from "lucide-react";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickLogOpen, setQuickLogOpen] = useState(false);

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
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAFA]">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between bg-[#FAFAFA] px-4">
        <NavMenu />

        <button
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-[#B5BAC0] transition-colors hover:bg-[#F2F3F5]"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="pointer-events-none hidden rounded bg-[#F2F3F5] px-1.5 text-[10px] font-medium text-[#C1C5CA] sm:inline">
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
    </div>
  );
}
