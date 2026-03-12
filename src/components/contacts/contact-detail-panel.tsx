"use client";

import { useState } from "react";
import { X, Pencil, Trash2, Mail, ExternalLink, Sparkles, Tag, Loader2, Linkedin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useContact, useDeleteContact, useUpdateContact } from "@/lib/hooks/use-contacts";
import { InteractionTimeline } from "@/components/contacts/interaction-timeline";
import { toast } from "sonner";
import { getAvatarColor, getInitials } from "@/lib/avatar";

const tierColors: Record<string, string> = {
  INNER_CIRCLE: "bg-gray-900 text-white",
  PROFESSIONAL: "bg-gray-200 text-gray-700",
  ACQUAINTANCE: "bg-gray-100 text-gray-500",
};

const tierLabels: Record<string, string> = {
  INNER_CIRCLE: "Inner Circle",
  PROFESSIONAL: "Professional",
  ACQUAINTANCE: "Acquaintance",
};

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
  const { data: contact, isLoading } = useContact(contactId);
  const deleteContact = useDeleteContact();
  const updateContact = useUpdateContact();
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [suggestedTags, setSuggestedTags] = useState<string[] | null>(null);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [linkedinInput, setLinkedinInput] = useState("");
  const [showLinkedinInput, setShowLinkedinInput] = useState(false);

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

  async function handleSuggestTags() {
    setTagsLoading(true);
    try {
      const res = await fetch("/api/ai/suggest-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      if (!res.ok) throw new Error("Failed to suggest tags");
      const data = await res.json();
      setSuggestedTags(data.tags);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to suggest tags");
    } finally {
      setTagsLoading(false);
    }
  }

  function acceptTag(tag: string) {
    if (!contact) return;
    const newTags = [...new Set([...contact.tags, tag])];
    updateContact.mutate(
      { id: contact.id, tags: newTags },
      { onSuccess: () => toast.success(`Tag "${tag}" added`) }
    );
    setSuggestedTags((prev) => prev?.filter((t) => t !== tag) ?? null);
  }

  function dismissTag(tag: string) {
    setSuggestedTags((prev) => prev?.filter((t) => t !== tag) ?? null);
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

  function handleDelete() {
    if (!confirm("Are you sure you want to delete this contact?")) return;
    deleteContact.mutate(contactId, {
      onSuccess: () => {
        toast.success("Contact deleted");
        onClose();
      },
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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between px-6 pt-6 pb-4">
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
              {contact.linkedinUrl && (
                <a
                  href={contact.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View LinkedIn profile"
                  className="text-[#0A66C2] hover:opacity-80 transition-opacity"
                >
                  <Linkedin className="h-4 w-4" />
                </a>
              )}
            </h2>
            {contact.company && (
              <p className="mt-0.5 text-[14px]" style={{ color: "var(--crm-text-secondary)" }}>
                {contact.role ? `${contact.role} at ` : ""}
                {contact.company}
              </p>
            )}
            <div className="mt-2 flex items-center gap-1.5">
              <Badge
                variant="secondary"
                className={`text-[11px] ${tierColors[contact.tier]}`}
              >
                {tierLabels[contact.tier]}
              </Badge>
              {contact.source && contact.source !== "MANUAL" && (
                <Badge
                  variant="outline"
                  className="text-[10px] text-gray-400 border-gray-200"
                >
                  {sourceLabels[contact.source] ?? contact.source}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors rounded-lg">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Quick actions */}
      <div className="flex gap-1.5 px-6 pb-4">
        <Button variant="outline" size="sm" className="h-8 text-[12px] rounded-lg hover:bg-gray-50 transition-colors" onClick={() => onEdit(contact.id)}>
          <Pencil className="mr-1 h-3 w-3" />
          Edit
        </Button>
        {contact.email && (
          <a href={`mailto:${contact.email}`}>
            <Button variant="outline" size="sm" className="h-8 text-[12px] rounded-lg hover:bg-gray-50 transition-colors">
              <Mail className="mr-1 h-3 w-3" />
              Email
            </Button>
          </a>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[12px] rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors"
          onClick={handleDelete}
        >
          <Trash2 className="mr-1 h-3 w-3" />
          Delete
        </Button>
      </div>

      <Separator />

      {/* Tabs */}
      <Tabs defaultValue="overview" className="flex-1 overflow-hidden">
        <TabsList className="mx-6 mt-2">
          <TabsTrigger value="overview" className="text-[13px]">Overview</TabsTrigger>
          <TabsTrigger value="timeline" className="text-[13px]">
            Timeline ({contact.interactions.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="overflow-y-auto px-6 pb-6">
          <div className="space-y-4 pt-2">
            {contact.email && (
              <InfoRow label="Email" value={contact.email} />
            )}
            {contact.phone && (
              <InfoRow label="Phone" value={contact.phone} />
            )}
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--crm-text-tertiary)" }}>LinkedIn</p>
              {contact.linkedinUrl ? (
                <a
                  href={contact.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] text-[#0A66C2] hover:underline"
                >
                  <Linkedin className="h-3.5 w-3.5" />
                  View Profile
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : showLinkedinInput ? (
                <div className="mt-1 flex items-center gap-1.5">
                  <input
                    type="text"
                    value={linkedinInput}
                    onChange={(e) => setLinkedinInput(e.target.value)}
                    placeholder="linkedin.com/in/username"
                    className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-[12px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    onKeyDown={(e) => e.key === "Enter" && handleSaveLinkedIn()}
                    autoFocus
                  />
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={handleSaveLinkedIn}
                    disabled={!linkedinInput.trim()}
                  >
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => { setShowLinkedinInput(false); setLinkedinInput(""); }}
                  >
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
            {contact.followUpDays && (
              <InfoRow
                label="Follow-up cadence"
                value={`Every ${contact.followUpDays} days`}
              />
            )}
            {contact.tags.length > 0 && (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider mb-1.5" style={{ color: "var(--crm-text-tertiary)" }}>Tags</p>
                <div className="flex flex-wrap gap-1">
                  {contact.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {contact.notes && (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider mb-1.5" style={{ color: "var(--crm-text-tertiary)" }}>Notes</p>
                <p className="whitespace-pre-wrap text-[13px] text-gray-700 leading-relaxed">
                  {contact.notes}
                </p>
              </div>
            )}

            {/* AI Summary */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--crm-text-tertiary)" }}>AI Summary</p>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleAiSummary}
                  disabled={aiLoading}
                >
                  {aiLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  <span className="ml-1">{aiSummary ? "Refresh" : "Generate"}</span>
                </Button>
              </div>
              {aiSummary && (
                <p className="rounded-xl bg-gray-50 p-3 text-[13px] text-gray-700 leading-relaxed">
                  {aiSummary}
                </p>
              )}
            </div>

            {/* Suggested Tags */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--crm-text-tertiary)" }}>Suggested Tags</p>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleSuggestTags}
                  disabled={tagsLoading}
                >
                  {tagsLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Tag className="h-3 w-3" />
                  )}
                  <span className="ml-1">Suggest</span>
                </Button>
              </div>
              {suggestedTags && suggestedTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {suggestedTags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="gap-1 border-gray-200 bg-gray-50 text-xs text-gray-700"
                    >
                      {tag}
                      <button
                        onClick={() => acceptTag(tag)}
                        className="text-gray-400 hover:text-gray-900 transition-colors"
                        title="Accept"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => dismissTag(tag)}
                        className="text-gray-300 hover:text-gray-900 transition-colors"
                        title="Dismiss"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="timeline" className="overflow-y-auto px-6 pb-6">
          <InteractionTimeline interactions={contact.interactions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--crm-text-tertiary)" }}>{label}</p>
      <p className="mt-0.5 text-[13px]" style={{ color: "var(--crm-text-primary)" }}>{value}</p>
    </div>
  );
}
