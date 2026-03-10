"use client";

import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Kanban,
  MessageSquare,
  Bell,
  Brain,
  Settings,
  ClipboardPaste,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const pages = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/interactions", label: "Interactions", icon: MessageSquare },
  { href: "/reminders", label: "Reminders", icon: Bell },
  { href: "/insights", label: "AI Insights", icon: Brain },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onQuickLog?: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onQuickLog,
}: CommandPaletteProps) {
  const router = useRouter();

  function navigateTo(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  function handleQuickLog() {
    onOpenChange(false);
    onQuickLog?.();
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages and actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {onQuickLog && (
          <CommandGroup heading="Actions">
            <CommandItem onSelect={handleQuickLog}>
              <ClipboardPaste className="mr-2 h-4 w-4" />
              Quick Log (Smart Paste)
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="Pages">
          {pages.map(({ href, label, icon: Icon }) => (
            <CommandItem key={href} onSelect={() => navigateTo(href)}>
              <Icon className="mr-2 h-4 w-4" />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
