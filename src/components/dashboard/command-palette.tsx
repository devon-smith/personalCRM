"use client";

import { useRouter } from "next/navigation";
import {
  Home,
  Users,
  CircleDot,
  Activity,
  Settings,
  ClipboardPaste,
  Inbox,
  FileEdit,
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
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/circles", label: "Circles", icon: CircleDot },
  { href: "/people", label: "People", icon: Users },
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
            <CommandItem onSelect={() => navigateTo("/dashboard#needs-response")}>
              <Inbox className="mr-2 h-4 w-4" />
              Who needs a response?
            </CommandItem>
            <CommandItem onSelect={() => navigateTo("/dashboard#drafts")}>
              <FileEdit className="mr-2 h-4 w-4" />
              Review drafts
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
