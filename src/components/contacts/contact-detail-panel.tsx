"use client";

import { useState } from "react";
import { X, Pencil, Trash2, Mail, ExternalLink, Sparkles, Tag, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useContact, useDeleteContact, useUpdateContact } from "@/lib/hooks/use-contacts";
import { InteractionTimeline } from "@/components/contacts/interaction-timeline";
import { toast } from "sonner";

const tierColors: Record<string, string> = {
  INNER_CIRCLE: "bg-purple-100 text-purple-700",
  PROFESSIONAL: "bg-blue-100 text-blue-700",
  ACQUAINTANCE: "bg-gray-100 text-gray-700",
};

const tierLabels: Record<string, string> = {
  INNER_CIRCLE: "Inner Circle",
  PROFESSIONAL: "Professional",
  ACQUAINTANCE: "Acquaintance",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
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
  const { data: contact, isLoading } = useContact(contactId);
  const deleteContact = useDeleteContact();
  const updateContact = useUpdateContact();
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [suggestedTags, setSuggestedTags] = useState<string[] | null>(null);
  const [tagsLoading, setTagsLoading] = useState(false);

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
      <div className="flex items-start justify-between p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12">
            <AvatarFallback className="bg-blue-100 text-blue-700">
              {getInitials(contact.name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {contact.name}
            </h2>
            {contact.company && (
              <p className="text-sm text-gray-500">
                {contact.role ? `${contact.role} at ` : ""}
                {contact.company}
              </p>
            )}
            <Badge
              variant="secondary"
              className={`mt-1 ${tierColors[contact.tier]}`}
            >
              {tierLabels[contact.tier]}
            </Badge>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 px-4 pb-3">
        <Button variant="outline" size="sm" onClick={() => onEdit(contact.id)}>
          <Pencil className="mr-1.5 h-3 w-3" />
          Edit
        </Button>
        {contact.email && (
          <a href={`mailto:${contact.email}`}>
            <Button variant="outline" size="sm">
              <Mail className="mr-1.5 h-3 w-3" />
              Email
            </Button>
          </a>
        )}
        <Button
          variant="outline"
          size="sm"
          className="text-red-600 hover:text-red-700"
          onClick={handleDelete}
        >
          <Trash2 className="mr-1.5 h-3 w-3" />
          Delete
        </Button>
      </div>

      <Separator />

      {/* Tabs */}
      <Tabs defaultValue="overview" className="flex-1 overflow-hidden">
        <TabsList className="mx-4 mt-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timeline">
            Timeline ({contact.interactions.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="overflow-y-auto px-4 pb-4">
          <div className="space-y-4 pt-2">
            {contact.email && (
              <InfoRow label="Email" value={contact.email} />
            )}
            {contact.phone && (
              <InfoRow label="Phone" value={contact.phone} />
            )}
            {contact.linkedinUrl && (
              <div>
                <p className="text-xs font-medium text-gray-500">LinkedIn</p>
                <a
                  href={contact.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                >
                  Profile
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            {contact.followUpDays && (
              <InfoRow
                label="Follow-up cadence"
                value={`Every ${contact.followUpDays} days`}
              />
            )}
            {contact.tags.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Tags</p>
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
                <p className="text-xs font-medium text-gray-500 mb-1">Notes</p>
                <p className="whitespace-pre-wrap text-sm text-gray-700">
                  {contact.notes}
                </p>
              </div>
            )}

            {/* AI Summary */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-gray-500">AI Summary</p>
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
                <p className="rounded-md bg-purple-50 p-2.5 text-sm text-purple-900">
                  {aiSummary}
                </p>
              )}
            </div>

            {/* Suggested Tags */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-gray-500">Suggested Tags</p>
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
                      className="gap-1 border-purple-200 bg-purple-50 text-xs text-purple-700"
                    >
                      {tag}
                      <button
                        onClick={() => acceptTag(tag)}
                        className="text-green-600 hover:text-green-800"
                        title="Accept"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => dismissTag(tag)}
                        className="text-gray-400 hover:text-red-600"
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

        <TabsContent value="timeline" className="overflow-y-auto px-4 pb-4">
          <InteractionTimeline interactions={contact.interactions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="text-sm text-gray-900">{value}</p>
    </div>
  );
}
