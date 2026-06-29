"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Home,
  Users,
  CircleDot,
  CalendarDays,
  Settings,
  ClipboardPaste,
  Inbox,
  FileEdit,
  User as UserIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useDebounce } from "@/lib/hooks/use-debounce";

const pages = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/circles", label: "Circles", icon: CircleDot },
  { href: "/people", label: "People", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

interface ContactHit {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  tier: string;
  avatarUrl: string | null;
  score: number;
  matchReason: string;
}

interface SearchResponse {
  hits: ContactHit[];
}

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
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 150);

  // Reset query when the palette closes so reopening starts blank. We
  // do this in the close handler (not a useEffect) to keep the state
  // update out of the render cycle.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setQuery("");
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const { data: searchData, isLoading: searching } = useQuery<SearchResponse>({
    queryKey: ["contact-search", debouncedQuery],
    queryFn: async () => {
      const res = await fetch(
        `/api/search/contacts?q=${encodeURIComponent(debouncedQuery)}&semantic=0`,
      );
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: open && debouncedQuery.trim().length >= 2,
    staleTime: 30_000,
  });
  const contactHits = searchData?.hits ?? [];

  function navigateTo(href: string) {
    handleOpenChange(false);
    router.push(href);
  }

  function handleQuickLog() {
    handleOpenChange(false);
    onQuickLog?.();
  }

  function openContact(contactId: string) {
    handleOpenChange(false);
    // /people opens the detail panel via ?contact=<id> — there's no
    // /people/[id] route. Using the query-param form keeps URL state
    // and back-button behavior consistent with clicking from the list.
    router.push(`/people?contact=${contactId}`);
  }

  // Show contact results above pages/actions when the user is typing.
  // shouldFilter=false because the server already ranks contact hits;
  // cmdk's client-side filter would otherwise drop them (their `value`
  // is the contact id, not the query text). Pages still appear because
  // we render them in the static-list path below the contact group.
  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      shouldFilter={false}
      className="ds-command-palette"
      showCloseButton={false}
    >
      <CommandInput
        placeholder="Search people, pages, actions…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {searching ? "Searching…" : "No results found."}
        </CommandEmpty>

        {contactHits.length > 0 && (
          <CommandGroup heading="Contacts">
            {contactHits.map((hit) => (
              <CommandItem
                key={hit.id}
                value={`contact-${hit.id}`}
                onSelect={() => openContact(hit.id)}
              >
                <UserIcon className="mr-2 h-4 w-4" />
                <div className="flex flex-1 items-center justify-between gap-2 min-w-0">
                  <span className="truncate">{hit.name}</span>
                  <span
                    className="text-[11px] truncate"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {[hit.role, hit.company].filter(Boolean).join(" · ") ||
                      hit.email ||
                      ""}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

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
