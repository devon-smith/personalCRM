"use client";

import { useState } from "react";
import {
  X, Pencil, Mail, Sparkles, Loader2, Linkedin, Plus, Phone,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useContact,
  useDeleteContact,
  useUpdateContact,
  type ContactWithCount,
  type ContactWithDetails,
} from "@/lib/hooks/use-contacts";
import { useMomentum } from "@/lib/hooks/use-momentum";
import { useDraftComposer } from "@/lib/draft-composer-context";
import { Sparkline, SparklineBadge } from "@/components/ui/sparkline";
import { Pill as DsPill } from "@/components/ds";
import { StoryFeed } from "@/components/contacts/story-feed";
import { VoiceRecorder } from "@/components/notes/voice-recorder";
import { IntelligenceSection } from "@/components/contacts/intelligence-section";
import { toast } from "sonner";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { formatDistanceToNow } from "@/lib/date-utils";
import Link from "next/link";

const moodLabels: Record<string, { label: string; color: string; bg: string }> = {
  POSITIVE: { label: "Positive", color: "#6B8A6E", bg: "#E4EBE3" }, // moss
  NEUTRAL:  { label: "Neutral",  color: "#5A574F", bg: "#EFEAE0" }, // sand
  CONCERN:  { label: "Concern",  color: "#7A4F3C", bg: "#F0E5DC" }, // terracotta
};

interface JournalEntry {
  id: string;
  content: string;
  mood: string;
  createdAt: string;
}

interface AliasUpdateResult {
  id: string;
  aliases: string[];
  additionalEmails: string[];
  additionalPhones: string[];
}

interface ContactDetailPanelProps {
  contactId: string;
  onClose: () => void;
  onEdit: (id: string) => void;
}

export function ContactDetailPanel({
  contactId,
  onClose,
  onEdit,
}: ContactDetailPanelProps) {
  const queryClient = useQueryClient();
  const { data: contact, isLoading } = useContact(contactId);
  const deleteContact = useDeleteContact();
  const updateContact = useUpdateContact();
  const { openComposer } = useDraftComposer();
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [linkedinInput, setLinkedinInput] = useState("");
  const [showLinkedinInput, setShowLinkedinInput] = useState(false);
  // Disclosure for empty optional sections (aliases / other emails /
  // other phones / birthday / LinkedIn when missing). Hides the empty
  // section headers behind one "Add more details" button so a typical
  // sparsely-populated contact doesn't show eight stub headers.
  const [showMore, setShowMore] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [editingHowWeMet, setEditingHowWeMet] = useState(false);
  const [howWeMetValue, setHowWeMetValue] = useState("");
  const [journalInput, setJournalInput] = useState("");
  const [journalMood, setJournalMood] = useState<string>("NEUTRAL");
  const [aliasInput, setAliasInput] = useState("");
  const [showAliasInput, setShowAliasInput] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [showPhoneInput, setShowPhoneInput] = useState(false);

  // Momentum
  const { data: momentumData } = useMomentum(contactId ? [contactId] : []);
  const momentum = momentumData?.momentum?.[0] ?? null;

  // Journal entries
  const { data: journalData } = useQuery<{ entries: JournalEntry[] }>({
    queryKey: ["journal", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/journal?contactId=${contactId}`);
      if (!res.ok) return { entries: [] };
      return res.json();
    },
    enabled: !!contactId,
    staleTime: 5 * 60 * 1000,
  });

  const addJournalEntry = useMutation({
    mutationFn: async (data: { contactId: string; content: string; mood: string }) => {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save entry");
      return res.json();
    },
    onSuccess: (entry: JournalEntry) => {
      queryClient.setQueryData<{ entries: JournalEntry[] }>(
        ["journal", contactId],
        (current) => ({ entries: [entry, ...(current?.entries ?? [])] }),
      );
      setJournalInput("");
      setJournalMood("NEUTRAL");
      toast.success("Journal entry added");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteJournalEntry = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/journal/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: (_data, deletedId) => {
      queryClient.setQueryData<{ entries: JournalEntry[] }>(
        ["journal", contactId],
        (current) => current
          ? { entries: current.entries.filter((entry) => entry.id !== deletedId) }
          : current,
      );
    },
  });

  async function handleAiSummary() {
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      if (!res.ok) throw new Error("Failed to generate summary");
      const data = await res.json();
      setAiSummary(data.summary);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate summary");
    } finally {
      setAiLoading(false);
    }
  }

  function handleSaveLinkedIn() {
    if (!contact || !linkedinInput.trim()) return;
    const url = linkedinInput.trim().startsWith("http")
      ? linkedinInput.trim()
      : `https://${linkedinInput.trim()}`;
    updateContact.mutate(
      { id: contact.id, linkedinUrl: url },
      {
        onSuccess: () => {
          toast.success("LinkedIn URL added");
          setShowLinkedinInput(false);
          setLinkedinInput("");
        },
      },
    );
  }

  function handleSaveNotes() {
    if (!contact) return;
    updateContact.mutate(
      { id: contact.id, notes: notesValue || null },
      { onSuccess: () => { setEditingNotes(false); toast.success("Notes saved"); } },
    );
  }

  function handleSaveHowWeMet() {
    if (!contact) return;
    updateContact.mutate(
      { id: contact.id, howWeMet: howWeMetValue || null } as Parameters<typeof updateContact.mutate>[0],
      { onSuccess: () => { setEditingHowWeMet(false); toast.success("Saved"); } },
    );
  }

  const updateAliases = useMutation({
    mutationFn: async (data: {
      aliases?: string[];
      additionalEmails?: string[];
      additionalPhones?: string[];
    }) => {
      const res = await fetch(`/api/contacts/${contactId}/aliases`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to update");
      }
      return res.json() as Promise<AliasUpdateResult>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ContactWithDetails>(
        ["contact", contactId],
        (current) => current ? { ...current, ...updated } : current,
      );
      queryClient.setQueryData<ContactWithCount>(
        ["contact-summary", contactId],
        (current) => current ? { ...current, ...updated } : current,
      );
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (err) => toast.error(err.message),
  });

  function handleAddAlias() {
    if (!contact || !aliasInput.trim()) return;
    const current = (contactAny.aliases as string[]) ?? [];
    updateAliases.mutate(
      { aliases: [...current, aliasInput.trim()] },
      { onSuccess: () => { setAliasInput(""); setShowAliasInput(false); toast.success("Alias added"); } },
    );
  }

  function handleRemoveAlias(alias: string) {
    if (!contact) return;
    const current = (contactAny.aliases as string[]) ?? [];
    updateAliases.mutate(
      { aliases: current.filter((a: string) => a !== alias) },
      { onSuccess: () => toast.success("Alias removed") },
    );
  }

  function handleAddEmail() {
    if (!contact || !emailInput.trim()) return;
    const current = (contactAny.additionalEmails as string[]) ?? [];
    updateAliases.mutate(
      { additionalEmails: [...current, emailInput.trim()] },
      { onSuccess: () => { setEmailInput(""); setShowEmailInput(false); toast.success("Email added"); } },
    );
  }

  function handleRemoveEmail(email: string) {
    if (!contact) return;
    const current = (contactAny.additionalEmails as string[]) ?? [];
    updateAliases.mutate(
      { additionalEmails: current.filter((e: string) => e !== email) },
      { onSuccess: () => toast.success("Email removed") },
    );
  }

  function handleAddPhone() {
    if (!contact || !phoneInput.trim()) return;
    const current = (contactAny.additionalPhones as string[]) ?? [];
    updateAliases.mutate(
      { additionalPhones: [...current, phoneInput.trim()] },
      { onSuccess: () => { setPhoneInput(""); setShowPhoneInput(false); toast.success("Phone added"); } },
    );
  }

  function handleRemovePhone(phone: string) {
    if (!contact) return;
    const current = (contactAny.additionalPhones as string[]) ?? [];
    updateAliases.mutate(
      { additionalPhones: current.filter((p: string) => p !== phone) },
      { onSuccess: () => toast.success("Phone removed") },
    );
  }

  function handleDelete() {
    if (!confirm("Are you sure you want to delete this contact?")) return;
    deleteContact.mutate(contactId, {
      onSuccess: () => { toast.success("Contact deleted"); onClose(); },
      onError: (err) => toast.error(err.message),
    });
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Contact not found</p>
      </div>
    );
  }

  const contactAny = contact as Record<string, unknown>;
  const birthday = contactAny.birthday ? new Date(contactAny.birthday as string) : null;
  const howWeMet = (contactAny.howWeMet as string) ?? null;

  // Calculate birthday countdown
  let birthdayDisplay: string | null = null;
  let birthdayIsToday = false;
  if (birthday) {
    const now = new Date();
    const thisYear = new Date(now.getFullYear(), birthday.getMonth(), birthday.getDate());
    if (thisYear.getMonth() < now.getMonth() || (thisYear.getMonth() === now.getMonth() && thisYear.getDate() < now.getDate())) {
      thisYear.setFullYear(now.getFullYear() + 1);
    }
    const diffDays = Math.round((thisYear.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / (1000 * 60 * 60 * 24));
    birthdayIsToday = diffDays === 0;
    const monthDay = birthday.toLocaleDateString("en-US", { month: "long", day: "numeric" });
    birthdayDisplay = birthdayIsToday ? `${monthDay} · today!` : `${monthDay} · in ${diffDays} days`;
  }

  // Compute stats
  const totalInteractions = contact.interactions.length;
  const emailCount = contact.interactions.filter((i) => i.type === "EMAIL").length;
  const meetingCount = contact.interactions.filter((i) => i.type === "MEETING").length;
  const firstInteraction = contact.interactions.length > 0
    ? contact.interactions[contact.interactions.length - 1]
    : null;

  const subline = [
    contact.role && contact.company ? `${contact.role} at ${contact.company}` : contact.role || contact.company,
    contact.lastInteraction
      ? `last contact ${formatDistanceToNow(new Date(contact.lastInteraction))}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-4 min-w-0">
            <Avatar className="h-14 w-14 rounded-2xl shrink-0">
              <AvatarFallback
                className="text-[15px] font-semibold rounded-2xl"
                style={{
                  backgroundColor: getAvatarColor(contact.name).bg,
                  color: getAvatarColor(contact.name).text,
                }}
              >
                {getInitials(contact.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h2 className="ds-display-lg truncate">{contact.name}</h2>
              {subline && (
                <p
                  className="ds-body-md mt-1.5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {subline}
                </p>
              )}
              {/* Tiny chips row: circles only. Source badge demoted into Details. */}
              {contact.circles && contact.circles.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {contact.circles.map((cc) => (
                    <span
                      key={cc.circle.id}
                      className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                      style={{ backgroundColor: `${cc.circle.color}1f`, color: cc.circle.color }}
                    >
                      {cc.circle.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onEdit(contact.id)}
              className="h-7 w-7 rounded-full inline-flex items-center justify-center transition-colors"
              style={{ color: "var(--text-tertiary)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text-primary)";
                e.currentTarget.style.backgroundColor = "var(--surface-mist-raised)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-tertiary)";
                e.currentTarget.style.backgroundColor = "";
              }}
              aria-label="Edit contact"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
            <button
              onClick={onClose}
              className="h-7 w-7 rounded-full inline-flex items-center justify-center transition-colors"
              style={{ color: "var(--text-tertiary)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text-primary)";
                e.currentTarget.style.backgroundColor = "var(--surface-mist-raised)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-tertiary)";
                e.currentTarget.style.backgroundColor = "";
              }}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Primary action + secondaries */}
      <div className="flex flex-wrap items-center gap-3 px-6 pb-4">
        <DsPill
          variant="filled"
          tone="accent"
          size="md"
          onClick={() => openComposer({ contactId: contact.id })}
        >
          Draft a message
        </DsPill>
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            className="text-[13px] font-medium transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            Email →
          </a>
        )}
        <button
          onClick={handleAiSummary}
          disabled={aiLoading}
          className="text-[13px] font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-1"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => {
            if (!aiLoading) e.currentTarget.style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
        >
          {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.6} />}
          {aiLoading ? "Generating…" : "Prep"}
        </button>
        {contact.linkedinUrl && (
          <a
            href={contact.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] font-medium transition-colors inline-flex items-center gap-1"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            <Linkedin className="h-3.5 w-3.5" strokeWidth={1.6} />
            LinkedIn
          </a>
        )}
      </div>

      {/* AI Summary inline */}
      {aiSummary && (
        <div className="mx-6 mb-3 rounded-xl bg-[#EFEAE0] p-3 text-[12px] text-[#1B1A17] leading-relaxed">
          {aiSummary}
        </div>
      )}

      <Separator />

      {/* Tabs — collapsed to two (Story / Details). Chat + Timeline +
          Journal merged into the Story chronological feed; About
          renamed to Details with empty sections collapsed. */}
      <Tabs defaultValue="story" className="flex-1 overflow-hidden flex flex-col">
        <TabsList className="mx-6 mt-2">
          <TabsTrigger value="story" className="text-[13px]">
            Story
            {(totalInteractions + (journalData?.entries.length ?? 0)) > 0
              ? ` (${totalInteractions + (journalData?.entries.length ?? 0)})`
              : ""}
          </TabsTrigger>
          <TabsTrigger value="details" className="text-[13px]">Details</TabsTrigger>
        </TabsList>

        {/* ═══ STORY TAB — chronological feed ═══ */}
        <TabsContent value="story" className="flex-1 overflow-y-auto px-6 pb-6 space-y-4">
          {/* M7.1 + M7.2 surfaces: "About them" + "People who know them".
              Self-hide when worker hasn't populated yet, so the existing
              story feed sits at the top until there's data. */}
          <IntelligenceSection contactId={contactId} />
          <StoryFeed
            interactions={contact.interactions.map((i) => ({
              id: i.id,
              type: i.type,
              direction: i.direction,
              channel: i.channel ?? null,
              subject: i.subject ?? null,
              summary: i.summary ?? null,
              occurredAt: i.occurredAt,
            }))}
            journal={journalData?.entries ?? []}
            onJournalDelete={(id) => deleteJournalEntry.mutate(id)}
            composer={
              <div className="space-y-3">
                <VoiceRecorder
                  contactId={contactId}
                  onTranscribed={(entry) => {
                    queryClient.setQueryData<{ entries: JournalEntry[] }>(
                      ["journal", contactId],
                      (current) => ({
                        entries: [
                          entry,
                          ...(current?.entries.filter(
                            (existing) => existing.id !== entry.id,
                          ) ?? []),
                        ],
                      }),
                    );
                  }}
                />
                <div
                  className="rounded-2xl p-3"
                  style={{ backgroundColor: "#F1ECDE", border: "1px solid #ECE7D9" }}
                >
                  <textarea
                    value={journalInput}
                    onChange={(e) => setJournalInput(e.target.value)}
                    placeholder="Add a private note about this relationship…"
                    className="w-full text-[13px] outline-none resize-none bg-transparent placeholder:text-[#8C8A82]"
                    rows={2}
                  />
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex gap-1">
                      {(["POSITIVE", "NEUTRAL", "CONCERN"] as const).map((mood) => {
                        const m = moodLabels[mood];
                        return (
                          <button
                            key={mood}
                            onClick={() => setJournalMood(mood)}
                            className="rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors"
                            style={{
                              backgroundColor: journalMood === mood ? m.bg : "transparent",
                              color: journalMood === mood ? m.color : "#8C8A82",
                              border: `1px solid ${journalMood === mood ? m.color + "40" : "#E0DBCC"}`,
                            }}
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                    <DsPill
                      variant="outline"
                      tone="neutral"
                      size="sm"
                      disabled={!journalInput.trim() || addJournalEntry.isPending}
                      onClick={() =>
                        addJournalEntry.mutate({
                          contactId,
                          content: journalInput,
                          mood: journalMood,
                        })
                      }
                      leadingIcon={
                        addJournalEntry.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Plus className="h-3 w-3" />
                        )
                      }
                    >
                      Add note
                    </DsPill>
                  </div>
                </div>
              </div>
            }
          />
        </TabsContent>

        {/* ═══ DETAILS TAB — structured fields ═══ */}
        <TabsContent value="details" className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="space-y-5 pt-2">
            {/* Circles */}
            {contact.circles && contact.circles.length > 0 && (
              <div>
                <SectionLabel>Circles</SectionLabel>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {contact.circles.map((cc) => (
                    <Link
                      key={cc.circle.id}
                      href={`/people?circle=${cc.circle.id}`}
                      className="rounded-lg px-2.5 py-1 text-[12px] font-medium hover:opacity-80 transition-opacity"
                      style={{ backgroundColor: `${cc.circle.color}15`, color: cc.circle.color }}
                    >
                      {cc.circle.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Aliases */}
            {(((contactAny.aliases as string[])?.length ?? 0) > 0 || showMore || showAliasInput) && (
            <div>
              <SectionLabel>Also known as</SectionLabel>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {((contactAny.aliases as string[]) ?? []).map((alias: string) => (
                  <span
                    key={alias}
                    className="group inline-flex items-center gap-1 rounded-lg bg-[#EFEAE0] px-2 py-1 text-[12px] text-[#5A574F]"
                  >
                    {alias}
                    <button
                      onClick={() => handleRemoveAlias(alias)}
                      className="opacity-0 group-hover:opacity-100 text-[#8C8A82] hover:text-[#7A4F3C] transition-all"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {showAliasInput ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={aliasInput}
                      onChange={(e) => setAliasInput(e.target.value)}
                      placeholder="Nickname or alias"
                      className="rounded-md border border-[#E0DBCC] px-2 py-1 text-[12px] outline-none focus:border-[#1B1A17] w-32"
                      onKeyDown={(e) => e.key === "Enter" && handleAddAlias()}
                      autoFocus
                    />
                    <button onClick={handleAddAlias} disabled={!aliasInput.trim()} className="text-[11px] font-medium text-[#5A574F] hover:text-[#1B1A17] disabled:opacity-50">Save</button>
                    <button onClick={() => { setShowAliasInput(false); setAliasInput(""); }} className="text-[#8C8A82] hover:text-[#5A574F]"><X className="h-3 w-3" /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAliasInput(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[#C9C3B2] px-2 py-1 text-[11px] text-[#8C8A82] hover:text-[#5A574F] hover:border-[#C9C3B2] transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    Add alias
                  </button>
                )}
              </div>
            </div>
            )}

            {/* Other emails */}
            {(((contactAny.additionalEmails as string[])?.length ?? 0) > 0 || showMore || showEmailInput) && (
            <div>
              <SectionLabel>Other emails</SectionLabel>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {((contactAny.additionalEmails as string[]) ?? []).map((email: string) => (
                  <span
                    key={email}
                    className="group inline-flex items-center gap-1 rounded-lg bg-[#EFEAE0] px-2 py-1 text-[12px] text-[#5A574F]"
                  >
                    <Mail className="h-3 w-3 text-[#8C8A82]" />
                    {email}
                    <button
                      onClick={() => handleRemoveEmail(email)}
                      className="opacity-0 group-hover:opacity-100 text-[#8C8A82] hover:text-[#7A4F3C] transition-all"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {showEmailInput ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="email@example.com"
                      className="rounded-md border border-[#E0DBCC] px-2 py-1 text-[12px] outline-none focus:border-[#1B1A17] w-44"
                      onKeyDown={(e) => e.key === "Enter" && handleAddEmail()}
                      autoFocus
                    />
                    <button onClick={handleAddEmail} disabled={!emailInput.trim()} className="text-[11px] font-medium text-[#5A574F] hover:text-[#1B1A17] disabled:opacity-50">Save</button>
                    <button onClick={() => { setShowEmailInput(false); setEmailInput(""); }} className="text-[#8C8A82] hover:text-[#5A574F]"><X className="h-3 w-3" /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowEmailInput(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[#C9C3B2] px-2 py-1 text-[11px] text-[#8C8A82] hover:text-[#5A574F] hover:border-[#C9C3B2] transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    Add email
                  </button>
                )}
              </div>
            </div>
            )}

            {/* Other phones */}
            {(((contactAny.additionalPhones as string[])?.length ?? 0) > 0 || showMore || showPhoneInput) && (
            <div>
              <SectionLabel>Other phones</SectionLabel>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {((contactAny.additionalPhones as string[]) ?? []).map((phone: string) => (
                  <span
                    key={phone}
                    className="group inline-flex items-center gap-1 rounded-lg bg-[#EFEAE0] px-2 py-1 text-[12px] text-[#5A574F]"
                  >
                    <Phone className="h-3 w-3 text-[#8C8A82]" />
                    {phone}
                    <button
                      onClick={() => handleRemovePhone(phone)}
                      className="opacity-0 group-hover:opacity-100 text-[#8C8A82] hover:text-[#7A4F3C] transition-all"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {showPhoneInput ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="tel"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      placeholder="+1 (555) 123-4567"
                      className="rounded-md border border-[#E0DBCC] px-2 py-1 text-[12px] outline-none focus:border-[#1B1A17] w-40"
                      onKeyDown={(e) => e.key === "Enter" && handleAddPhone()}
                      autoFocus
                    />
                    <button onClick={handleAddPhone} disabled={!phoneInput.trim()} className="text-[11px] font-medium text-[#5A574F] hover:text-[#1B1A17] disabled:opacity-50">Save</button>
                    <button onClick={() => { setShowPhoneInput(false); setPhoneInput(""); }} className="text-[#8C8A82] hover:text-[#5A574F]"><X className="h-3 w-3" /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowPhoneInput(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[#C9C3B2] px-2 py-1 text-[11px] text-[#8C8A82] hover:text-[#5A574F] hover:border-[#C9C3B2] transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    Add phone
                  </button>
                )}
              </div>
            </div>
            )}

            {/* How you know them */}
            {(howWeMet || showMore || editingHowWeMet) && (
            <div>
              <SectionLabel>How you know them</SectionLabel>
              {editingHowWeMet ? (
                <div className="mt-1">
                  <textarea
                    value={howWeMetValue}
                    onChange={(e) => setHowWeMetValue(e.target.value)}
                    className="w-full rounded-lg border border-[#E0DBCC] px-3 py-2 text-[13px] outline-none focus:border-[#C9C3B2] resize-none"
                    rows={2}
                    autoFocus
                  />
                  <div className="flex gap-1.5 mt-1">
                    <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={handleSaveHowWeMet}>Save</Button>
                    <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setEditingHowWeMet(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setHowWeMetValue(howWeMet ?? ""); setEditingHowWeMet(true); }}
                  className="mt-0.5 text-[13px] text-[#5A574F] hover:text-[#1B1A17] transition-colors text-left"
                >
                  {howWeMet || "Click to add..."}
                </button>
              )}
            </div>
            )}

            {/* Notes */}
            {(contact.notes || showMore || editingNotes) && (
            <div>
              <SectionLabel>Notes</SectionLabel>
              {editingNotes ? (
                <div className="mt-1">
                  <textarea
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    className="w-full rounded-lg border border-[#E0DBCC] px-3 py-2 text-[13px] outline-none focus:border-[#C9C3B2] resize-none"
                    rows={3}
                    autoFocus
                  />
                  <div className="flex gap-1.5 mt-1">
                    <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={handleSaveNotes}>Save</Button>
                    <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setEditingNotes(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setNotesValue(contact.notes ?? ""); setEditingNotes(true); }}
                  className="mt-0.5 text-[13px] text-[#5A574F] hover:text-[#1B1A17] transition-colors whitespace-pre-wrap text-left"
                >
                  {contact.notes || "Click to add..."}
                </button>
              )}
            </div>
            )}

            {/* Birthday — auto-hides when not set; use the Edit dialog
                to add one rather than inline. */}
            {birthdayDisplay && (
              <div>
                <SectionLabel>Birthday</SectionLabel>
                <p className={`mt-0.5 text-[13px] ${birthdayIsToday ? "font-semibold text-[#B08B3F]" : "text-[#1B1A17]"}`}>
                  {birthdayDisplay}
                </p>
              </div>
            )}

            {/* LinkedIn (only when missing AND user opted into more details) */}
            {!contact.linkedinUrl && (showMore || showLinkedinInput) && (
              <div>
                <SectionLabel>LinkedIn</SectionLabel>
                {showLinkedinInput ? (
                  <div className="mt-1 flex items-center gap-1.5">
                    <input
                      type="text"
                      value={linkedinInput}
                      onChange={(e) => setLinkedinInput(e.target.value)}
                      placeholder="linkedin.com/in/username"
                      className="flex-1 rounded-md border border-[#E0DBCC] px-2 py-1 text-[12px] outline-none focus:border-[#1B1A17]"
                      onKeyDown={(e) => e.key === "Enter" && handleSaveLinkedIn()}
                      autoFocus
                    />
                    <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={handleSaveLinkedIn} disabled={!linkedinInput.trim()}>Save</Button>
                    <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => { setShowLinkedinInput(false); setLinkedinInput(""); }}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowLinkedinInput(true)}
                    className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-[#8C8A82] hover:text-[#0A66C2] transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    Add LinkedIn
                  </button>
                )}
              </div>
            )}

            {/* Momentum */}
            {momentum && momentum.trend !== "inactive" && (
              <div>
                <SectionLabel>Momentum</SectionLabel>
                <div className="mt-1.5 flex items-center gap-3">
                  <Sparkline data={momentum.sparkline} trend={momentum.trend} width={96} height={28} />
                  <SparklineBadge trend={momentum.trend} />
                </div>
                <p className="mt-1 text-[11px] text-[#8C8A82]">12-week interaction trend</p>
              </div>
            )}

            {/* Stats */}
            <div>
              <SectionLabel>Stats</SectionLabel>
              <p className="mt-0.5 text-[13px] text-[#5A574F]">
                {totalInteractions} total interactions
                {emailCount > 0 && ` · ${emailCount} emails`}
                {meetingCount > 0 && ` · ${meetingCount} meetings`}
              </p>
              {firstInteraction && (
                <p className="text-[12px] text-[#8C8A82]">
                  First interaction: {new Date(firstInteraction.occurredAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                </p>
              )}
              <p className="text-[12px] text-[#8C8A82]">
                Added: {new Date(contact.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </p>
            </div>

            {/* Tags */}
            {contact.tags.length > 0 && (
              <div>
                <SectionLabel>Tags</SectionLabel>
                <div className="flex flex-wrap gap-1 mt-1">
                  {contact.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Follow-up cadence */}
            {contact.followUpDays && (
              <div>
                <SectionLabel>Follow-up cadence</SectionLabel>
                <p className="mt-0.5 text-[13px] text-[#5A574F]">Every {contact.followUpDays} days</p>
              </div>
            )}

            {/* Disclosure for empty optional sections. Click reveals
                the inputs to add aliases / other emails / other phones /
                how-we-met / notes / LinkedIn. Hides itself once any of
                those have content (they render above without the
                disclosure). */}
            <div className="pt-2">
              <button
                onClick={() => setShowMore((v) => !v)}
                className="text-[12px] font-medium transition-colors"
                style={{ color: "#8C8A82" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#5A574F";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#8C8A82";
                }}
              >
                {showMore ? "Hide empty fields ↑" : "Add more details ↓"}
              </button>
            </div>
          </div>
        </TabsContent>

      </Tabs>

      {/* Bottom actions */}
      <div className="border-t border-[#ECE7D9] px-6 py-3 flex items-center gap-3">
        <Link href="/merge" className="text-[12px] text-[#8C8A82] hover:text-[#5A574F] transition-colors">
          Merge with...
        </Link>
        <button
          onClick={handleDelete}
          className="text-[12px] text-[#8C8A82] hover:text-[#7A4F3C] transition-colors"
        >
          Delete contact
        </button>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "#8C8A82" }}>
      {children}
    </p>
  );
}
