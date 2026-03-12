"use client";

import { useState } from "react";
import {
  X, Pencil, Trash2, Mail, ExternalLink, Sparkles, Tag,
  Loader2, Linkedin, Plus, Phone, StickyNote, Archive,
  Merge, Calendar, Send,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useContact, useDeleteContact, useUpdateContact } from "@/lib/hooks/use-contacts";
import { useMomentum } from "@/lib/hooks/use-momentum";
import { useDraftComposer } from "@/lib/draft-composer-context";
import { Sparkline, SparklineBadge } from "@/components/ui/sparkline";
import { InteractionTimeline } from "@/components/contacts/interaction-timeline";
import { toast } from "sonner";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { formatDistanceToNow } from "@/lib/date-utils";
import Link from "next/link";

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

const moodLabels: Record<string, { label: string; color: string; bg: string }> = {
  POSITIVE: { label: "Positive", color: "#4A8C5E", bg: "#EBF5EE" },
  NEUTRAL: { label: "Neutral", color: "#7B8189", bg: "#F3F4F6" },
  CONCERN: { label: "Concern", color: "#BF5040", bg: "#FAEAE7" },
};

interface JournalEntry {
  id: string;
  content: string;
  mood: string;
  createdAt: string;
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
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [editingHowWeMet, setEditingHowWeMet] = useState(false);
  const [howWeMetValue, setHowWeMetValue] = useState("");
  const [journalInput, setJournalInput] = useState("");
  const [journalMood, setJournalMood] = useState<string>("NEUTRAL");

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal", contactId] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal", contactId] });
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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between px-6 pt-6 pb-3">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 rounded-2xl">
            <AvatarFallback
              className="text-lg font-semibold rounded-2xl"
              style={{
                backgroundColor: getAvatarColor(contact.name).bg,
                color: getAvatarColor(contact.name).text,
              }}
            >
              {getInitials(contact.name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <h2 className="text-[20px] font-bold tracking-tight flex items-center gap-1.5" style={{ color: "var(--crm-text-primary)" }}>
              {contact.name}
            </h2>
            {contact.company && (
              <p className="mt-0.5 text-[14px]" style={{ color: "var(--crm-text-secondary)" }}>
                {contact.role ? `${contact.role} at ` : ""}
                {contact.company}
              </p>
            )}
            {/* Source badges */}
            <div className="mt-1.5 flex items-center gap-1 flex-wrap">
              {contact.source && (
                <Badge variant="outline" className="text-[10px] text-gray-400 border-gray-200 py-0">
                  {sourceLabels[contact.source] ?? contact.source}
                </Badge>
              )}
              {contact.circles?.map((cc) => (
                <span
                  key={cc.circle.id}
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ backgroundColor: `${cc.circle.color}15`, color: cc.circle.color }}
                >
                  {cc.circle.name}
                </span>
              ))}
            </div>
            {/* Contact links */}
            <div className="mt-1.5 flex items-center gap-3 text-[12px] flex-wrap">
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="text-gray-500 hover:text-gray-900 truncate max-w-[200px]">
                  {contact.email}
                </a>
              )}
              {((contactAny.additionalEmails as string[]) ?? []).map((ae: string) => (
                <a key={ae} href={`mailto:${ae}`} className="text-gray-500 hover:text-gray-900 truncate max-w-[200px]">
                  {ae}
                </a>
              ))}
              {contact.phone && (
                <a href={`tel:${contact.phone}`} className="text-gray-500 hover:text-gray-900">
                  {contact.phone}
                </a>
              )}
              {contact.linkedinUrl && (
                <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-[#0A66C2] hover:opacity-80">
                  <Linkedin className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors rounded-lg">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Quick actions row */}
      <div className="flex gap-1.5 px-6 pb-3 flex-wrap">
        <Button variant="outline" size="sm" className="h-7 text-[11px] rounded-lg" onClick={() => onEdit(contact.id)}>
          <Pencil className="mr-1 h-3 w-3" />
          Edit
        </Button>
        {contact.email && (
          <a href={`mailto:${contact.email}`}>
            <Button variant="outline" size="sm" className="h-7 text-[11px] rounded-lg">
              <Mail className="mr-1 h-3 w-3" />
              Email
            </Button>
          </a>
        )}
        {contact.linkedinUrl && (
          <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="h-7 text-[11px] rounded-lg">
              <Linkedin className="mr-1 h-3 w-3" />
              LinkedIn
            </Button>
          </a>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] rounded-lg"
          onClick={handleAiSummary}
          disabled={aiLoading}
        >
          {aiLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
          Prep
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] rounded-lg"
          onClick={() => openComposer({ contactId: contact.id })}
        >
          <Send className="mr-1 h-3 w-3" />
          Draft
        </Button>
      </div>

      {/* AI Summary inline */}
      {aiSummary && (
        <div className="mx-6 mb-3 rounded-xl bg-gray-50 p-3 text-[12px] text-gray-700 leading-relaxed">
          {aiSummary}
        </div>
      )}

      <Separator />

      {/* Tabs */}
      <Tabs defaultValue="timeline" className="flex-1 overflow-hidden flex flex-col">
        <TabsList className="mx-6 mt-2">
          <TabsTrigger value="timeline" className="text-[13px]">
            Timeline ({totalInteractions})
          </TabsTrigger>
          <TabsTrigger value="about" className="text-[13px]">About</TabsTrigger>
          <TabsTrigger value="journal" className="text-[13px]">
            Journal{journalData?.entries.length ? ` (${journalData.entries.length})` : ""}
          </TabsTrigger>
        </TabsList>

        {/* ═══ TIMELINE TAB ═══ */}
        <TabsContent value="timeline" className="flex-1 overflow-y-auto px-6 pb-6">
          <InteractionTimeline interactions={contact.interactions} />
        </TabsContent>

        {/* ═══ ABOUT TAB ═══ */}
        <TabsContent value="about" className="flex-1 overflow-y-auto px-6 pb-6">
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

            {/* How you know them */}
            <div>
              <SectionLabel>How you know them</SectionLabel>
              {editingHowWeMet ? (
                <div className="mt-1">
                  <textarea
                    value={howWeMetValue}
                    onChange={(e) => setHowWeMetValue(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-gray-400 resize-none"
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
                  className="mt-0.5 text-[13px] text-gray-500 hover:text-gray-900 transition-colors text-left"
                >
                  {howWeMet || "Click to add..."}
                </button>
              )}
            </div>

            {/* Notes */}
            <div>
              <SectionLabel>Notes</SectionLabel>
              {editingNotes ? (
                <div className="mt-1">
                  <textarea
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-gray-400 resize-none"
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
                  className="mt-0.5 text-[13px] text-gray-500 hover:text-gray-900 transition-colors whitespace-pre-wrap text-left"
                >
                  {contact.notes || "Click to add..."}
                </button>
              )}
            </div>

            {/* Birthday */}
            {birthdayDisplay && (
              <div>
                <SectionLabel>Birthday</SectionLabel>
                <p className={`mt-0.5 text-[13px] ${birthdayIsToday ? "font-semibold text-amber-600" : "text-gray-700"}`}>
                  {birthdayDisplay}
                </p>
              </div>
            )}

            {/* LinkedIn (if not in header) */}
            {!contact.linkedinUrl && (
              <div>
                <SectionLabel>LinkedIn</SectionLabel>
                {showLinkedinInput ? (
                  <div className="mt-1 flex items-center gap-1.5">
                    <input
                      type="text"
                      value={linkedinInput}
                      onChange={(e) => setLinkedinInput(e.target.value)}
                      placeholder="linkedin.com/in/username"
                      className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-[12px] outline-none focus:border-blue-500"
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
                    className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-gray-400 hover:text-[#0A66C2] transition-colors"
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
                <p className="mt-1 text-[11px] text-gray-400">12-week interaction trend</p>
              </div>
            )}

            {/* Stats */}
            <div>
              <SectionLabel>Stats</SectionLabel>
              <p className="mt-0.5 text-[13px] text-gray-600">
                {totalInteractions} total interactions
                {emailCount > 0 && ` · ${emailCount} emails`}
                {meetingCount > 0 && ` · ${meetingCount} meetings`}
              </p>
              {firstInteraction && (
                <p className="text-[12px] text-gray-400">
                  First interaction: {new Date(firstInteraction.occurredAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                </p>
              )}
              <p className="text-[12px] text-gray-400">
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
                <p className="mt-0.5 text-[13px] text-gray-600">Every {contact.followUpDays} days</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ═══ JOURNAL TAB ═══ */}
        <TabsContent value="journal" className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="pt-2">
            {/* Add entry */}
            <div className="rounded-xl border border-gray-200 p-3">
              <textarea
                value={journalInput}
                onChange={(e) => setJournalInput(e.target.value)}
                placeholder="Add a private note about this relationship..."
                className="w-full text-[13px] outline-none resize-none placeholder:text-gray-400"
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
                        className="rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors"
                        style={{
                          backgroundColor: journalMood === mood ? m.bg : "transparent",
                          color: journalMood === mood ? m.color : "#9BA1A8",
                          border: `1px solid ${journalMood === mood ? m.color + "30" : "#E8EAED"}`,
                        }}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  disabled={!journalInput.trim() || addJournalEntry.isPending}
                  onClick={() => addJournalEntry.mutate({ contactId, content: journalInput, mood: journalMood })}
                >
                  {addJournalEntry.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                  Add
                </Button>
              </div>
            </div>

            {/* Entries */}
            <div className="mt-4 space-y-3">
              {!journalData?.entries.length ? (
                <p className="text-center text-[13px] text-gray-400 py-6">
                  No journal entries yet
                </p>
              ) : (
                journalData.entries.map((entry) => {
                  const m = moodLabels[entry.mood] ?? moodLabels.NEUTRAL;
                  return (
                    <div key={entry.id} className="group rounded-xl border border-gray-100 p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold"
                            style={{ backgroundColor: m.bg, color: m.color }}
                          >
                            {m.label}
                          </span>
                          <span className="text-[11px] text-gray-400">
                            {formatDistanceToNow(new Date(entry.createdAt))}
                          </span>
                        </div>
                        <button
                          onClick={() => deleteJournalEntry.mutate(entry.id)}
                          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <p className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {entry.content}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Bottom actions */}
      <div className="border-t border-gray-100 px-6 py-3 flex items-center gap-3">
        <Link href="/merge" className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors">
          Merge with...
        </Link>
        <button
          onClick={handleDelete}
          className="text-[12px] text-gray-400 hover:text-red-600 transition-colors"
        >
          Delete contact
        </button>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--crm-text-tertiary)" }}>
      {children}
    </p>
  );
}
