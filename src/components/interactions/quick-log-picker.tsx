"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useContacts } from "@/lib/hooks/use-contacts";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { SmartPasteDialog } from "./smart-paste-dialog";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

interface QuickLogPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickLogPicker({ open, onOpenChange }: QuickLogPickerProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const debouncedSearch = useDebounce(search, 200);
  const { data: contacts } = useContacts({ search: debouncedSearch });

  const filtered = contacts?.slice(0, 8) ?? [];

  function handleSelect(contact: { id: string; name: string }) {
    setSelected(contact);
  }

  function handleClose() {
    setSearch("");
    setSelected(null);
    onOpenChange(false);
  }

  if (selected) {
    return (
      <SmartPasteDialog
        open
        onOpenChange={(o) => {
          if (!o) handleClose();
        }}
        contactId={selected.id}
        contactName={selected.name}
      />
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
        else onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quick Log — Select Contact</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No contacts found
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map((contact) => (
                <button
                  key={contact.id}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-gray-100"
                  onClick={() =>
                    handleSelect({ id: contact.id, name: contact.name })
                  }
                >
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-blue-100 text-xs text-blue-700">
                      {getInitials(contact.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {contact.name}
                    </p>
                    {contact.company && (
                      <p className="truncate text-xs text-gray-500">
                        {contact.company}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
