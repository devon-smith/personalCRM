"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Merge,
  Check,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Users,
  AlertCircle,
  Linkedin,
  ArrowRight,
  UserPlus,
  Cake,
  Search,
  ArrowDown,
  X,
  MessageSquare,
  Phone,
  Mail,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { useContacts } from "@/lib/hooks/use-contacts";
import type { DuplicateGroup } from "@/app/api/contacts/duplicates/route";
import { formatDistanceToNow } from "@/lib/date-utils";

const sourceLabels: Record<string, string> = {
  MANUAL: "Manual",
  CSV_IMPORT: "CSV",
  GOOGLE_CONTACTS: "Google",
  GMAIL_DISCOVER: "Gmail",
  APPLE_CONTACTS: "Apple",
  IMESSAGE: "iMessage",
  LINKEDIN: "LinkedIn",
  WHATSAPP: "WhatsApp",
};

const tierLabels: Record<string, string> = {
  INNER_CIRCLE: "Inner Circle",
  PROFESSIONAL: "Professional",
  ACQUAINTANCE: "Acquaintance",
};

const matchTypeLabels: Record<string, string> = {
  exact_name: "Same name",
  name_and_email: "Same email",
  name_and_phone: "Same phone",
};

interface DuplicatesResponse {
  groups: DuplicateGroup[];
  totalGroups: number;
  totalDuplicates: number;
}

export default function MergePage() {
  const queryClient = useQueryClient();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedPrimary, setSelectedPrimary] = useState<Record<string, string>>({});
  const [mergedGroups, setMergedGroups] = useState<Set<string>>(new Set());

  // Check for LinkedIn review items
  const { data: linkedInReview } = useQuery<{ totalPending: number }>({
    queryKey: ["linkedin-review-count"],
    queryFn: async () => {
      const res = await fetch("/api/import/linkedin/review");
      if (!res.ok) return { totalPending: 0 };
      const data = await res.json();
      return { totalPending: data.totalPending ?? 0 };
    },
  });

  const { data, isLoading } = useQuery<DuplicatesResponse>({
    queryKey: ["duplicates"],
    queryFn: async () => {
      const res = await fetch("/api/contacts/duplicates");
      if (!res.ok) throw new Error("Failed to fetch duplicates");
      return res.json();
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ primaryId, mergeIds }: { primaryId: string; mergeIds: string[] }) => {
      const res = await fetch("/api/contacts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryId, mergeIds }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Merge failed");
      }
      return res.json();
    },
    onSuccess: (_data, _variables) => {
      toast("Contacts merged successfully");
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["duplicates"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const [mergeAllProgress, setMergeAllProgress] = useState({ current: 0, total: 0 });

  const mergeAllMutation = useMutation({
    mutationFn: async (groups: DuplicateGroup[]) => {
      setMergeAllProgress({ current: 0, total: groups.length });
      const mergedKeys: string[] = [];

      for (const group of groups) {
        const sorted = [...group.contacts].sort(
          (a, b) => b.interactionCount - a.interactionCount,
        );
        const primary = sorted[0];
        const mergeIds = sorted.slice(1).map((c) => c.id);

        const res = await fetch("/api/contacts/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ primaryId: primary.id, mergeIds }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? `Merge failed for ${group.normalizedName}`);
        }
        mergedKeys.push(group.key);
        setMergeAllProgress((prev) => ({ ...prev, current: prev.current + 1 }));
      }
      return mergedKeys;
    },
    onSuccess: (mergedKeys) => {
      toast(`Merged ${mergedKeys.length} duplicate groups`);
      setMergedGroups((prev) => {
        const next = new Set(prev);
        mergedKeys.forEach((k) => next.add(k));
        return next;
      });
      setMergeAllProgress({ current: 0, total: 0 });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["duplicates"] });
    },
    onError: (err) => {
      setMergeAllProgress({ current: 0, total: 0 });
      toast.error(err.message);
    },
  });

  function toggleExpand(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleSelectPrimary(groupKey: string, contactId: string) {
    setSelectedPrimary((prev) => ({ ...prev, [groupKey]: contactId }));
  }

  function handleMergeGroup(group: DuplicateGroup) {
    const primaryId = selectedPrimary[group.key] ?? getBestPrimary(group);
    const mergeIds = group.contacts
      .filter((c) => c.id !== primaryId)
      .map((c) => c.id);

    mergeMutation.mutate(
      { primaryId, mergeIds },
      {
        onSuccess: () => {
          setMergedGroups((prev) => new Set([...prev, group.key]));
        },
      },
    );
  }

  function handleMergeAll() {
    if (!data) return;
    const exactNameGroups = data.groups.filter(
      (g) => g.matchType === "exact_name" && !mergedGroups.has(g.key),
    );
    if (exactNameGroups.length === 0) {
      toast("No exact-name duplicates to merge");
      return;
    }
    mergeAllMutation.mutate(exactNameGroups);
  }

  function getBestPrimary(group: DuplicateGroup): string {
    // Pick the contact with the most interactions, then the one with more data
    const sorted = [...group.contacts].sort((a, b) => {
      if (b.interactionCount !== a.interactionCount) {
        return b.interactionCount - a.interactionCount;
      }
      const aFields = [a.email, a.phone, a.company, a.role].filter(Boolean).length;
      const bFields = [b.email, b.phone, b.company, b.role].filter(Boolean).length;
      return bFields - aFields;
    });
    return sorted[0].id;
  }

  const visibleGroups = (data?.groups ?? []).filter((g) => !mergedGroups.has(g.key));
  const exactNameCount = visibleGroups.filter((g) => g.matchType === "exact_name").length;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="ds-display-lg">Merge Duplicates</h1>
          <p className="mt-1 ds-body-sm" style={{ color: "var(--text-tertiary)" }}>Scanning your contacts...</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Finding duplicates...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="ds-display-lg">Merge Duplicates</h1>
          <p className="mt-1 ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
            {visibleGroups.length === 0
              ? "No duplicates found. Your contacts are clean!"
              : `Found ${visibleGroups.length} groups with ${data?.totalDuplicates ?? 0} duplicate contacts`}
          </p>
        </div>
        {exactNameCount > 0 && (
          <Button
            onClick={handleMergeAll}
            disabled={mergeAllMutation.isPending}
            className="gap-2"
          >
            {mergeAllMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Merging {mergeAllProgress.current}/{mergeAllProgress.total}...
              </>
            ) : (
              <>
                <Merge className="h-4 w-4" />
                Auto-merge {exactNameCount} exact matches
              </>
            )}
          </Button>
        )}
      </div>

      {/* Data Enrichment */}
      <BirthdayExtraction />

      {/* Manual Merge */}
      <ManualMerge />

      {/* LinkedIn review banner */}
      {linkedInReview && linkedInReview.totalPending > 0 && (
        <Link href="/merge/linkedin">
          <div className="flex items-center gap-3 rounded-2xl border border-[#0A66C2]/20 bg-[#0A66C2]/5 px-5 py-4 transition-colors hover:bg-[#0A66C2]/10 cursor-pointer">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0A66C2]/10">
              <Linkedin className="h-4 w-4 text-[#0A66C2]" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-medium text-gray-900">
                LinkedIn Review Queue
              </p>
              <p className="text-[11px] text-gray-500">
                {linkedInReview.totalPending} connections need your review
                — possible matches, job changes, and partial name matches
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-[#0A66C2]" />
          </div>
        </Link>
      )}

      {/* Empty state */}
      {visibleGroups.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-50">
            <Check className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-lg font-medium text-gray-900">All clean!</p>
          <p className="mt-1 text-sm text-gray-400">No duplicate contacts were found.</p>
        </div>
      )}

      {/* Duplicate groups */}
      <div className="space-y-3">
        {visibleGroups.map((group) => {
          const isExpanded = expandedGroups.has(group.key);
          const primaryId = selectedPrimary[group.key] ?? getBestPrimary(group);

          return (
            <div
              key={group.key}
              className="rounded-2xl border border-gray-200 bg-white overflow-hidden"
            >
              {/* Group header */}
              <button
                onClick={() => toggleExpand(group.key)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                )}
                <Users className="h-4 w-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-900">
                    {group.contacts[0].name}
                  </span>
                  <span className="ml-2 text-xs text-gray-400">
                    {group.contacts.length} contacts
                  </span>
                </div>
                <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                  {matchTypeLabels[group.matchType] ?? group.matchType}
                </span>
                <span className="text-xs text-gray-400">
                  {group.contacts.map((c) => sourceLabels[c.source] ?? c.source).join(", ")}
                </span>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t border-gray-100 px-5 py-4">
                  <div className="mb-3 flex items-center gap-2 text-xs text-gray-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Select the primary contact to keep. Others will be merged into it.
                  </div>

                  <div className="space-y-2">
                    {group.contacts.map((contact) => {
                      const color = getAvatarColor(contact.name);
                      const isPrimary = contact.id === primaryId;

                      return (
                        <button
                          key={contact.id}
                          onClick={() => handleSelectPrimary(group.key, contact.id)}
                          className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all ${
                            isPrimary
                              ? "bg-gray-900 text-white ring-2 ring-gray-900"
                              : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                          }`}
                        >
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback
                              className="text-[10px] font-semibold"
                              style={
                                isPrimary
                                  ? { backgroundColor: "rgba(255,255,255,0.2)", color: "#fff" }
                                  : { backgroundColor: color.bg, color: color.text }
                              }
                            >
                              {getInitials(contact.name)}
                            </AvatarFallback>
                          </Avatar>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">
                                {contact.name}
                              </span>
                              {isPrimary && (
                                <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">
                                  PRIMARY
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] opacity-70">
                              {contact.email && <span>{contact.email}</span>}
                              {contact.phone && <span>{contact.phone}</span>}
                              {contact.company && <span>{contact.company}</span>}
                            </div>
                          </div>

                          <div className="shrink-0 text-right text-[11px] opacity-60 space-y-0.5">
                            <div>{sourceLabels[contact.source]}</div>
                            <div>{tierLabels[contact.tier]}</div>
                            <div>
                              {contact.interactionCount > 0
                                ? `${contact.interactionCount} interactions`
                                : "No interactions"}
                            </div>
                            {contact.lastInteraction && (
                              <div>
                                Last: {formatDistanceToNow(new Date(contact.lastInteraction))}
                              </div>
                            )}
                          </div>

                          {!isPrimary && (
                            <Trash2 className="h-3.5 w-3.5 shrink-0 opacity-40" />
                          )}
                          {isPrimary && (
                            <Check className="h-4 w-4 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => handleMergeGroup(group)}
                      disabled={mergeMutation.isPending}
                      className="gap-2"
                    >
                      {mergeMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Merge className="h-3.5 w-3.5" />
                      )}
                      Merge into {group.contacts.find((c) => c.id === primaryId)?.name}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Gaps & Suggestions */}
      <GapsSuggestions />
    </div>
  );
}

// ─── Unmatched Messages ────────────────────────────────────


interface BirthdaySyncEntry {
  readonly name: string;
  readonly birthday: string;
}

interface BirthdaySyncResult {
  readonly scanned: number;
  readonly matched: number;
  readonly updated: number;
  readonly alreadyHad: number;
  readonly entries: readonly BirthdaySyncEntry[];
}

function formatBirthday(iso: string): string {
  const [year, month, day] = iso.split("-");
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function BirthdayExtraction() {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<BirthdaySyncResult | null>(null);

  const syncBirthdays = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/birthdays", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Birthday sync failed");
      return res.json() as Promise<BirthdaySyncResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.updated > 0) {
        toast(`Found ${data.updated} new birthdays from calendar`);
      } else if (data.matched > 0) {
        toast(`All ${data.matched} matched birthdays already saved`);
      } else {
        toast(`Scanned ${data.scanned} events — no matches found`);
      }
      queryClient.invalidateQueries({ queryKey: ["birthdays"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div
      className="rounded-[14px] overflow-hidden"
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-3 px-5 py-4">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: "var(--status-warning-bg)" }}
        >
          <Cake className="h-4 w-4" style={{ color: "var(--status-warning)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="ds-body-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Birthday Extraction
          </p>
          <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            Scan Google Calendar &amp; imported contacts for birthdays
          </p>
        </div>
        <button
          onClick={() => syncBirthdays.mutate()}
          disabled={syncBirthdays.isPending}
          className="flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
          style={{
            backgroundColor: "var(--surface-sunken)",
            color: "var(--text-secondary)",
            transitionDuration: "var(--duration-fast)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--border)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
        >
          {syncBirthdays.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Cake className="h-3 w-3" />
          )}
          {syncBirthdays.isPending ? "Scanning..." : "Extract"}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="px-5 pb-4">
          <div
            className="rounded-[10px] px-4 py-3"
            style={{ backgroundColor: "var(--surface-sunken)" }}
          >
            {result.updated > 0 ? (
              <>
                <p className="ds-body-sm font-medium" style={{ color: "var(--status-success)" }}>
                  Saved {result.updated} new birthday{result.updated !== 1 ? "s" : ""}
                </p>
                <div className="mt-2 space-y-1.5">
                  {result.entries.map((entry) => (
                    <div key={entry.name} className="flex items-center justify-between">
                      <span className="ds-body-sm" style={{ color: "var(--text-primary)" }}>
                        {entry.name}
                      </span>
                      <span className="ds-caption font-medium" style={{ color: "var(--text-secondary)" }}>
                        {formatBirthday(entry.birthday)}
                      </span>
                    </div>
                  ))}
                </div>
                {result.alreadyHad > 0 && (
                  <p className="mt-2 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {result.alreadyHad} contact{result.alreadyHad !== 1 ? "s" : ""} already had birthdays
                  </p>
                )}
              </>
            ) : result.matched > 0 ? (
              <p className="ds-body-sm" style={{ color: "var(--text-secondary)" }}>
                All {result.matched} matched birthdays were already saved
              </p>
            ) : (
              <p className="ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
                Scanned {result.scanned} events — no matching contacts found
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface SimpleContact {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly company: string | null;
  readonly avatarUrl: string | null;
}

function ContactSearchPicker({
  contacts,
  excludeId,
  placeholder,
  onSelect,
}: {
  contacts: SimpleContact[];
  excludeId?: string;
  placeholder: string;
  onSelect: (contact: SimpleContact) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return contacts
      .filter(
        (c) =>
          c.id !== excludeId &&
          (c.name.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q) ||
            c.company?.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [contacts, excludeId, query]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  return (
    <div className="relative">
      <div
        className="flex items-center gap-2 rounded-[10px] px-3 py-2"
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <Search className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-tertiary)" }} />
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="flex-1 bg-transparent text-[13px] outline-none"
          style={{ color: "var(--text-primary)" }}
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setOpen(false); }}
            className="shrink-0"
            style={{ color: "var(--text-tertiary)" }}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full z-10 mt-1 max-h-[240px] overflow-y-auto rounded-[10px]"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          {filtered.map((contact) => {
            const color = getAvatarColor(contact.name);
            return (
              <button
                key={contact.id}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors"
                style={{ transitionDuration: "var(--duration-fast)" }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
                onClick={() => {
                  onSelect(contact);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback
                    className="text-[9px] font-semibold"
                    style={{ backgroundColor: color.bg, color: color.text }}
                  >
                    {getInitials(contact.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="ds-body-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {contact.name}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: "var(--text-tertiary)" }}>
                    {[contact.email, contact.company].filter(Boolean).join(" · ") || "No details"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SelectedContactCard({
  contact,
  label,
  onClear,
}: {
  contact: SimpleContact;
  label: string;
  onClear: () => void;
}) {
  const color = getAvatarColor(contact.name);
  return (
    <div
      className="flex items-center gap-3 rounded-[10px] px-3 py-2.5"
      style={{ backgroundColor: "var(--surface-sunken)" }}
    >
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback
          className="text-[10px] font-semibold"
          style={{ backgroundColor: color.bg, color: color.text }}
        >
          {getInitials(contact.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
          {label}
        </p>
        <p className="ds-body-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
          {contact.name}
        </p>
        <p className="text-[11px] truncate" style={{ color: "var(--text-tertiary)" }}>
          {[contact.email, contact.company].filter(Boolean).join(" · ") || "No details"}
        </p>
      </div>
      <button
        onClick={onClear}
        className="shrink-0 rounded-[6px] p-1 transition-colors"
        style={{ color: "var(--text-tertiary)", transitionDuration: "var(--duration-fast)" }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.backgroundColor = "var(--border)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; e.currentTarget.style.backgroundColor = ""; }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ManualMerge() {
  const queryClient = useQueryClient();
  const { data: contactsData } = useContacts();
  const [sourceContact, setSourceContact] = useState<SimpleContact | null>(null);
  const [targetContact, setTargetContact] = useState<SimpleContact | null>(null);
  const [expanded, setExpanded] = useState(false);

  const contacts: SimpleContact[] = useMemo(
    () =>
      (contactsData ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        company: c.company,
        avatarUrl: c.avatarUrl,
      })),
    [contactsData],
  );

  const mergeMutation = useMutation({
    mutationFn: async ({ primaryId, mergeIds }: { primaryId: string; mergeIds: string[] }) => {
      const res = await fetch("/api/contacts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryId, mergeIds }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Merge failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast("Contacts merged successfully");
      setSourceContact(null);
      setTargetContact(null);
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["duplicates"] });
    },
    onError: (err) => toast.error(err.message),
  });

  function handleMerge() {
    if (!sourceContact || !targetContact) return;
    mergeMutation.mutate({
      primaryId: targetContact.id,
      mergeIds: [sourceContact.id],
    });
  }

  if (!expanded) {
    return (
      <button
        className="flex w-full items-center gap-3 rounded-[14px] px-5 py-4 transition-colors"
        style={{
          backgroundColor: "var(--surface)",
          border: "1px solid var(--border)",
          transitionDuration: "var(--duration-fast)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--surface)"; }}
        onClick={() => setExpanded(true)}
      >
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: "var(--surface-sunken)" }}
        >
          <Merge className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="ds-body-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Manual Merge
          </p>
          <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            Pick two contacts to merge into one
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--text-tertiary)" }} />
      </button>
    );
  }

  return (
    <div
      className="rounded-[14px] overflow-hidden"
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: "var(--surface-sunken)" }}
        >
          <Merge className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="ds-body-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Manual Merge
          </p>
          <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            The source contact will be merged into the target and deleted
          </p>
        </div>
        <button
          onClick={() => { setExpanded(false); setSourceContact(null); setTargetContact(null); }}
          className="shrink-0 rounded-[6px] p-1 transition-colors"
          style={{ color: "var(--text-tertiary)", transitionDuration: "var(--duration-fast)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Merge UI */}
      <div className="px-5 pb-5 space-y-3">
        {/* Source (will be deleted) */}
        {sourceContact ? (
          <SelectedContactCard
            contact={sourceContact}
            label="Merge away (will be deleted)"
            onClear={() => setSourceContact(null)}
          />
        ) : (
          <ContactSearchPicker
            contacts={contacts}
            excludeId={targetContact?.id}
            placeholder="Search for contact to merge away..."
            onSelect={setSourceContact}
          />
        )}

        {/* Arrow */}
        <div className="flex justify-center">
          <ArrowDown className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
        </div>

        {/* Target (will be kept) */}
        {targetContact ? (
          <SelectedContactCard
            contact={targetContact}
            label="Keep (primary)"
            onClear={() => setTargetContact(null)}
          />
        ) : (
          <ContactSearchPicker
            contacts={contacts}
            excludeId={sourceContact?.id}
            placeholder="Search for contact to keep..."
            onSelect={setTargetContact}
          />
        )}

        {/* Merge button */}
        <button
          onClick={handleMerge}
          disabled={!sourceContact || !targetContact || mergeMutation.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 ds-body-sm font-medium transition-colors disabled:opacity-40"
          style={{
            backgroundColor: sourceContact && targetContact ? "var(--accent-color)" : "var(--surface-sunken)",
            color: sourceContact && targetContact ? "var(--text-inverse)" : "var(--text-tertiary)",
            transitionDuration: "var(--duration-fast)",
          }}
        >
          {mergeMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Merge className="h-3.5 w-3.5" />
          )}
          {mergeMutation.isPending
            ? "Merging..."
            : sourceContact && targetContact
              ? `Merge ${sourceContact.name} into ${targetContact.name}`
              : "Select two contacts to merge"}
        </button>
      </div>
    </div>
  );
}

function GapsSuggestions() {
  const { data } = useQuery<{
    unmatchedSenders: { email: string; count: number }[];
    zeroInteractionContacts: { id: string; name: string; email: string | null; company: string | null }[];
  }>({
    queryKey: ["data-health"],
    queryFn: async () => {
      const res = await fetch("/api/data-health");
      if (!res.ok) return { unmatchedSenders: [], zeroInteractionContacts: [] };
      return res.json();
    },
  });

  const [showGaps, setShowGaps] = useState(false);

  if (!data) return null;
  const total = data.unmatchedSenders.length + data.zeroInteractionContacts.length;
  if (total === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setShowGaps(!showGaps)}
        className="flex w-full items-center justify-between rounded-2xl border border-gray-200 bg-white px-5 py-4 transition-colors hover:bg-gray-50"
      >
        <h2 className="text-[14px] font-semibold text-gray-900">
          Gaps & Suggestions
        </h2>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
            {total}
          </span>
          <ChevronDown
            className="h-4 w-4 text-gray-400 transition-transform"
            style={{ transform: showGaps ? "rotate(180deg)" : "rotate(0)" }}
          />
        </div>
      </button>

      {showGaps && (
        <div className="mt-3 space-y-4 rounded-2xl border border-gray-200 bg-white px-5 py-4">
          {data.unmatchedSenders.length > 0 && (
            <div>
              <p className="text-[12px] font-medium text-gray-600">
                People you might know ({data.unmatchedSenders.length})
              </p>
              <p className="text-[11px] text-gray-400">
                Email addresses that appear 3+ times but aren&apos;t contacts yet
              </p>
              <div className="mt-2 space-y-1">
                {data.unmatchedSenders.map((sender) => (
                  <div key={sender.email} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-gray-50">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-[11px] font-semibold text-amber-600">
                      @
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-gray-900 truncate">{sender.email}</p>
                      <p className="text-[11px] text-gray-400">{sender.count} emails</p>
                    </div>
                    <a
                      href={`/people?new=true&email=${encodeURIComponent(sender.email)}`}
                      className="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-200"
                    >
                      <UserPlus className="h-3 w-3" />
                      Add
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.zeroInteractionContacts.length > 0 && (
            <div>
              <p className="text-[12px] font-medium text-gray-600">
                Contacts with no interactions ({data.zeroInteractionContacts.length})
              </p>
              <div className="mt-2 space-y-1">
                {data.zeroInteractionContacts.slice(0, 10).map((contact) => {
                  const color = getAvatarColor(contact.name);
                  return (
                    <Link
                      key={contact.id}
                      href={`/people?contact=${contact.id}`}
                      className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-gray-50"
                    >
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-[10px] font-semibold" style={{ backgroundColor: color.bg, color: color.text }}>
                          {getInitials(contact.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-gray-900 truncate">{contact.name}</p>
                        <p className="text-[11px] text-gray-400 truncate">{contact.company ?? contact.email ?? "No details"}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
