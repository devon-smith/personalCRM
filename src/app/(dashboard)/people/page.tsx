"use client";

import { Suspense, useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Plus, Search, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ContactList } from "@/components/contacts/contact-list";
import { ContactDetailPanel } from "@/components/contacts/contact-detail-panel";
import { ContactFormDialog } from "@/components/contacts/contact-form-dialog";
import { ContactImportDialog } from "@/components/contacts/contact-import-dialog";
import type { ContactWithCount } from "@/lib/hooks/use-contacts";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { Pill, FilterPill } from "@/components/ds";
import { deploymentFeatures } from "@/lib/deployment-features";

const sourceOptions = [
  { value: "", label: "All sources" },
  { value: "MANUAL", label: "Manual" },
  { value: "CSV_IMPORT", label: "CSV Import" },
  { value: "GOOGLE_CONTACTS", label: "Google Contacts" },
  { value: "GMAIL_DISCOVER", label: "Gmail" },
  { value: "APPLE_CONTACTS", label: "Apple Contacts" },
  ...(deploymentFeatures.imessage
    ? [{ value: "IMESSAGE", label: "iMessage" }]
    : []),
];

const sortOptions = [
  { value: "name", label: "Name (A–Z)" },
  { value: "lastInteraction", label: "Most recent" },
  { value: "createdAt", label: "Date added" },
];

interface PeopleBootstrapResponse {
  contacts: ContactWithCount[];
  circles: { id: string; name: string; color: string }[];
  totalPendingDuplicates: number;
}

export default function ContactsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12">
          <p className="ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
            Loading contacts…
          </p>
        </div>
      }
    >
      <ContactsPageInner />
    </Suspense>
  );
}

function ContactsPageInner() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [circleId, setCircleId] = useState("");
  const [source, setSource] = useState("");
  const [sort, setSort] = useState("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => {
    // URL → state sync. The lint rule against setState-in-effect doesn't
    // apply cleanly here: we genuinely want subsequent URL changes
    // (e.g. command-palette deep links) to update the selection while
    // the page stays mounted.
    const contactId = searchParams.get("contact");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (contactId) setSelectedId(contactId);
    const circleParam = searchParams.get("circle");
    if (circleParam) setCircleId(circleParam);
  }, [searchParams]);

  const debouncedSearch = useDebounce(search, 300);

  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      circle: circleId || undefined,
      source: source || undefined,
      sort,
    }),
    [debouncedSearch, circleId, source, sort],
  );

  const { data: bootstrap, isLoading } = useQuery<PeopleBootstrapResponse>({
    queryKey: ["contacts", "people-bootstrap", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.search) params.set("search", filters.search);
      if (filters.circle) params.set("circle", filters.circle);
      if (filters.source) params.set("source", filters.source);
      if (filters.sort) params.set("sort", filters.sort);

      const queryString = params.toString();
      const res = await fetch(
        `/api/people/bootstrap${queryString ? `?${queryString}` : ""}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to load people");
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const contacts = bootstrap?.contacts ?? [];
  const circles = bootstrap?.circles;
  const duplicateCount = bootstrap?.totalPendingDuplicates ?? 0;

  const circleOptions = useMemo(
    () => [
      { value: "", label: "All circles" },
      ...(circles ?? []).map((c) => ({ value: c.id, label: c.name })),
    ],
    [circles],
  );

  function openCreate() {
    setEditId(null);
    setFormOpen(true);
  }
  function openEdit(id: string) {
    setEditId(id);
    setFormOpen(true);
  }

  const contactCount = contacts.length;

  return (
    <div
      className="relative flex h-[calc(100vh-7rem)] gap-0 overflow-hidden rounded-[14px] border bg-white shadow-[0_1px_2px_rgba(40,30,20,0.03)]"
      style={{ borderColor: "#EAE2D6" }}
    >
      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div
          className="flex flex-wrap items-end justify-between gap-3 border-b px-5 py-4 sm:px-7"
          style={{ borderColor: "#EAE2D6" }}
        >
          <div>
            <div
              className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "#B5613F" }}
            >
              Relationship Graph
            </div>
            <div className="flex items-end gap-3">
              <h1
                className="font-serif text-[29px] font-medium leading-none"
                style={{ color: "#1B1A17" }}
              >
                People
              </h1>
              <span className="pb-0.5 text-[11.5px]" style={{ color: "#8A8276" }}>
                {contactCount.toLocaleString()} contacts
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {duplicateCount > 0 && (
              <Link
                href="/merge"
                className="ds-caption transition-colors hover:underline"
                style={{ color: "var(--text-tertiary)" }}
              >
                {duplicateCount} duplicate{duplicateCount === 1 ? "" : "s"} to review →
              </Link>
            )}
            <Pill
              variant="outline"
              tone="neutral"
              size="md"
              leadingIcon={<Upload className="h-3.5 w-3.5" strokeWidth={1.8} />}
              onClick={() => setImportOpen(true)}
            >
              Import
            </Pill>
            <Pill
              variant="filled"
              tone="accent"
              size="md"
              leadingIcon={<Plus className="h-3.5 w-3.5" strokeWidth={2} />}
              onClick={openCreate}
            >
              Add contact
            </Pill>
          </div>
        </div>

        {/* Filter row — pill-shaped */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 sm:px-7">
          <div className="relative flex-1 min-w-[220px] max-w-[420px]">
            <Search
              className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={{ color: "var(--text-tertiary)" }}
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or company"
              className="pl-9 rounded-full"
              style={{
                backgroundColor: "var(--accent-soft)",
                border: "1px solid transparent",
              }}
            />
          </div>
          <FilterPill
            label="All circles"
            options={circleOptions}
            value={circleId}
            onChange={(e) => setCircleId(e.target.value)}
            active={!!circleId}
          />
          <FilterPill
            label="All sources"
            options={sourceOptions}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            active={!!source}
          />
          <FilterPill
            label="Sort"
            options={sortOptions}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
                Loading contacts…
              </p>
            </div>
          ) : (
            <ContactList
              contacts={contacts ?? []}
              onSelect={setSelectedId}
              selectedId={selectedId}
            />
          )}
        </div>
      </div>

      {/* Detail panel — floats over the right edge of the list so the
          list stays in view at narrow widths. Hex background so the
          mist tone reaches the screen regardless of CSS-var cascade. */}
      {selectedId && (
        <div
          className="absolute right-0 top-0 bottom-0 w-full sm:w-[520px] overflow-hidden z-20 animate-in slide-in-from-right duration-200"
          style={{
            borderLeft: "1px solid #ECE7D9",
            backgroundColor: "#E8E4DC",
            boxShadow: "-12px 0 32px rgba(27,26,23,0.08)",
          }}
        >
          <ContactDetailPanel
            contactId={selectedId}
            onClose={() => setSelectedId(null)}
            onEdit={openEdit}
          />
        </div>
      )}

      <ContactFormDialog open={formOpen} onOpenChange={setFormOpen} editId={editId} />
      <ContactImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
