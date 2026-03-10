"use client";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

const pageTitles: Record<string, string> = {
  "/dashboard": "Home",
  "/contacts": "Contacts",
  "/pipeline": "Pipeline",
  "/interactions": "Interactions",
  "/reminders": "Reminders",
  "/settings": "Settings",
};

interface TopBarProps {
  onSearchOpen: () => void;
}

export function TopBar({ onSearchOpen }: TopBarProps) {
  const pathname = usePathname();
  const title = pageTitles[pathname] ?? "Personal CRM";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-400">CRM</span>
        <span className="text-gray-300">/</span>
        <span className="font-medium text-gray-900">{title}</span>
      </div>

      {/* Search trigger */}
      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-gray-500"
        onClick={onSearchOpen}
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="pointer-events-none hidden rounded border border-gray-200 bg-gray-50 px-1.5 text-[10px] font-medium text-gray-400 sm:inline">
          ⌘K
        </kbd>
      </Button>
    </header>
  );
}
