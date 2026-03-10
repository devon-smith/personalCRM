"use client";

import { useState, useMemo } from "react";
import { Plus, Search, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ContactTable } from "@/components/contacts/contact-table";
import { ContactDetailPanel } from "@/components/contacts/contact-detail-panel";
import { ContactFormDialog } from "@/components/contacts/contact-form-dialog";
import { ContactImportDialog } from "@/components/contacts/contact-import-dialog";
import { useContacts } from "@/lib/hooks/use-contacts";
import { useDebounce } from "@/lib/hooks/use-debounce";

const tierOptions = [
  { value: "", label: "All Tiers" },
  { value: "INNER_CIRCLE", label: "Inner Circle" },
  { value: "PROFESSIONAL", label: "Professional" },
  { value: "ACQUAINTANCE", label: "Acquaintance" },
];

const sortOptions = [
  { value: "name", label: "Name" },
  { value: "lastInteraction", label: "Last Contact" },
  { value: "createdAt", label: "Date Added" },
];

export default function ContactsPage() {
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("");
  const [sort, setSort] = useState("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      tier: tier || undefined,
      sort,
    }),
    [debouncedSearch, tier, sort]
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
          <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
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
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or company..."
              className="pl-9"
            />
          </div>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="h-8 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none focus:border-blue-500"
          >
            {tierOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="h-8 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none focus:border-blue-500"
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto rounded-lg border border-gray-200 bg-white">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">Loading contacts...</p>
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
        <div className="w-[380px] shrink-0 border-l border-gray-200 bg-white overflow-hidden">
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
