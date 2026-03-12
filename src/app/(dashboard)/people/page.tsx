"use client";

import { Suspense, useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ContactTable } from "@/components/contacts/contact-table";
import { ContactDetailPanel } from "@/components/contacts/contact-detail-panel";
import { ContactFormDialog } from "@/components/contacts/contact-form-dialog";
import { ContactImportDialog } from "@/components/contacts/contact-import-dialog";
import { useContacts } from "@/lib/hooks/use-contacts";
import { useDebounce } from "@/lib/hooks/use-debounce";

const sourceOptions = [
  { value: "", label: "All Sources" },
  { value: "MANUAL", label: "Manual" },
  { value: "CSV_IMPORT", label: "CSV Import" },
  { value: "GOOGLE_CONTACTS", label: "Google Contacts" },
  { value: "GMAIL_DISCOVER", label: "Gmail" },
  { value: "APPLE_CONTACTS", label: "Apple Contacts" },
  { value: "IMESSAGE", label: "iMessage" },
];

const sortOptions = [
  { value: "name", label: "Name" },
  { value: "lastInteraction", label: "Last Contact" },
  { value: "createdAt", label: "Date Added" },
];

const selectClass =
  "h-9 rounded-[10px] px-3 text-sm outline-none transition-colors" +
  " focus-visible:ring-[3px]";

export default function ContactsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-12"><p className="ds-body-sm" style={{ color: "var(--text-tertiary)" }}>Loading contacts...</p></div>}>
      <ContactsPageInner />
    </Suspense>
  );
}

function ContactsPageInner() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [circleId, setCircleId] = useState("");
  const [source, setSource] = useState("");

  const { data: circles } = useQuery<{ id: string; name: string; color: string }[]>({
    queryKey: ["circles-filter"],
    queryFn: async () => {
      const res = await fetch("/api/circles");
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : data.circles ?? [];
    },
  });
  const [sort, setSort] = useState("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => {
    const contactId = searchParams.get("contact");
    if (contactId) {
      setSelectedId(contactId);
    }
    const circleParam = searchParams.get("circle");
    if (circleParam) {
      setCircleId(circleParam);
    }
  }, [searchParams]);

  const debouncedSearch = useDebounce(search, 300);

  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      circle: circleId || undefined,
      source: source || undefined,
      sort,
    }),
    [debouncedSearch, circleId, source, sort]
  );

  const { data: contacts, isLoading } = useContacts(filters);

  function openCreate() {
    setEditId(null);
    setFormOpen(true);
  }

  function openEdit(id: string) {
    setEditId(id);
    setFormOpen(true);
  }

  return (
    <div className="flex h-[calc(100vh-theme(spacing.14)-theme(spacing.14))] gap-0">
      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
          <h1 className="ds-display-lg">Contacts</h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1.5 h-4 w-4" />
              Import
            </Button>
            <Button onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add Contact
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 pb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--text-tertiary)" }} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or company..."
              className="pl-9"
            />
          </div>
          <select
            value={circleId}
            onChange={(e) => setCircleId(e.target.value)}
            className={selectClass}
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
            }}
          >
            <option value="">All Circles</option>
            {circles?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className={selectClass}
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
            }}
          >
            {sourceOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className={selectClass}
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
            }}
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div
          className="flex-1 overflow-y-auto rounded-[14px]"
          style={{
            border: "1px solid var(--border)",
            backgroundColor: "var(--surface)",
          }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="ds-body-sm" style={{ color: "var(--text-tertiary)" }}>Loading contacts...</p>
            </div>
          ) : (
            <ContactTable
              contacts={contacts ?? []}
              onSelect={setSelectedId}
              selectedId={selectedId}
            />
          )}
        </div>
      </div>

      {/* Detail panel slide-over */}
      {selectedId && (
        <div
          className="w-[520px] shrink-0 overflow-hidden"
          style={{
            borderLeft: "1px solid var(--border)",
            backgroundColor: "var(--surface)",
          }}
        >
          <ContactDetailPanel
            contactId={selectedId}
            onClose={() => setSelectedId(null)}
            onEdit={openEdit}
          />
        </div>
      )}

      {/* Add/Edit Dialog */}
      <ContactFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editId={editId}
      />

      {/* Import Dialog */}
      <ContactImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
      />
    </div>
  );
}
