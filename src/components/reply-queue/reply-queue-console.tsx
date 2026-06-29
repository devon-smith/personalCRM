"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Ban,
  Check,
  CheckCircle2,
  Inbox,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { formatDistanceToNow } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

interface MessagePreview {
  summary: string;
  occurredAt: string;
  channel: string;
}

interface InboxItemData {
  id: string;
  contactId: string;
  contactName: string;
  company: string | null;
  tier: string;
  channel: string;
  threadKey: string;
  contactEmail: string | null;
  triggerAt: string;
  lastInboundAt?: string;
  messagePreview: MessagePreview[] | null;
  messageCount: number;
  status: string;
  hasDraft?: boolean;
  priority?: "high" | "medium" | "low";
  priorityScore?: number;
  priorityReason?: string;
  responseConfidence?: number | null;
  responseReason?: string | null;
  responseCategory?: string | null;
}

interface InboxItemsData {
  items: InboxItemData[];
  totalOpen: number;
  needsReplyCount?: number;
  allInboundCount?: number;
}

interface DraftContact {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  avatarUrl: string | null;
}

interface Draft {
  id: string;
  type: string;
  tone: string;
  content: string;
  subjectLine: string | null;
  status: string;
  createdAt: string;
  inboxItemId: string | null;
  gmailDraftId: string | null;
  savedToGmailAt: string | null;
  contact: DraftContact;
}

interface ReplyContextSnapshot {
  latestInbound: {
    fromEmail: string;
    fromName: string | null;
    subject: string | null;
    body: string;
    bodyIsFull: boolean;
    occurredAt: string;
  };
  threadHistory: Array<{
    direction: string;
    fromEmail: string;
    fromName: string | null;
    subject: string | null;
    snippet: string | null;
    occurredAt: string;
  }>;
}

interface MemorySnapshot {
  personalContext: unknown;
  recurringThemes: string[];
  openThreads: unknown[];
}

interface ReferenceSnapshot {
  id: string;
  filename: string;
  sourceType: string;
  toneNotes: string;
}

interface DraftWorkspaceAudit {
  context: {
    relationshipType: string;
    replyContext: ReplyContextSnapshot | null;
    memory: MemorySnapshot | null;
    references: ReferenceSnapshot[];
  };
}

interface ContactDetail {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  tier: string;
  notes: string | null;
  lastInteraction: string | null;
  circles: { circle: { id: string; name: string; color: string } }[];
  interactions: {
    id: string;
    type: string;
    channel: string | null;
    subject: string | null;
    summary: string | null;
    occurredAt: string;
  }[];
  personFacts?: {
    id: string;
    type: string;
    value: string;
    confidence: number;
    sourceSystem: string;
    observedAt: string;
    confirmedByUser: boolean;
  }[];
  profile?: {
    expertiseAreas: string[];
    relationshipStage: string | null;
    communicationStyle: unknown;
    geographicContext: unknown;
    personalitySignals: unknown;
  } | null;
  memory?: {
    discussedTopics: unknown;
    theyMentioned: unknown;
    openThreads: unknown;
    personalContext: unknown;
    recurringThemes: string[];
  } | null;
}

interface DataHealthResponse {
  googleAccounts: { needsReconnect: boolean; lastSyncedAt: string | null }[];
}

interface ReplyQueueBootstrapData {
  inbox: InboxItemsData;
  drafts: { drafts: Draft[] };
  dataHealth: DataHealthResponse;
}

const STATUS_STYLES = {
  review: { text: "#8A5A36", bg: "#F3E6D8", label: "Needs review" },
  ready: { text: "#5E6B47", bg: "#EDF0EC", label: "Ready to save" },
  blocked: { text: "#7A4F3C", bg: "#F0E5DC", label: "Reconnect needed" },
  saved: { text: "#5E6B47", bg: "#EDF0EC", label: "Saved to Gmail" },
} as const;

function priorityLabel(item: InboxItemData): string {
  if (item.priority === "high") return "High priority";
  if (item.priority === "medium") return "Medium";
  return "Earlier";
}

function previewText(item: InboxItemData): string {
  const previews = item.messagePreview ?? [];
  if (previews.length > 0) return previews[0].summary;
  return item.responseReason ?? item.priorityReason ?? "Inbound message awaiting review.";
}

function subjectText(item: InboxItemData): string {
  const first = previewText(item);
  if (first.length <= 92) return first;
  return `${first.slice(0, 89).trim()}...`;
}

function relationshipLabel(contact?: ContactDetail | null, item?: InboxItemData | null): string {
  if (contact?.role && contact.company) return `${contact.role} at ${contact.company}`;
  if (contact?.role) return contact.role;
  if (item?.company) return item.company;
  return item?.tier ? item.tier.toLowerCase().replaceAll("_", " ") : "relationship";
}

function statusFor(draft: Draft | undefined, googleBlocked: boolean) {
  if (googleBlocked) return STATUS_STYLES.blocked;
  if (draft?.gmailDraftId || draft?.savedToGmailAt) return STATUS_STYLES.saved;
  if (draft) return STATUS_STYLES.ready;
  return STATUS_STYLES.review;
}

export function ReplyQueueConsole() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"all" | "needs-review" | "ready">("all");
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    data: bootstrapData,
    isLoading: bootstrapLoading,
    isFetching: bootstrapFetching,
    dataUpdatedAt: bootstrapUpdatedAt,
    refetch: refetchBootstrap,
  } = useQuery<ReplyQueueBootstrapData>({
    queryKey: ["reply-queue-bootstrap", "needs-reply"],
    queryFn: async () => {
      const res = await fetch("/api/reply-queue/bootstrap");
      if (!res.ok) {
        return {
          inbox: { items: [], totalOpen: 0 },
          drafts: { drafts: [] },
          dataHealth: { googleAccounts: [] },
        };
      }
      return res.json();
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const inboxData = bootstrapData?.inbox;
  const draftsData = bootstrapData?.drafts;
  const dataHealth = bootstrapData?.dataHealth;

  const items = useMemo(() => inboxData?.items ?? [], [inboxData?.items]);
  const drafts = useMemo(() => draftsData?.drafts ?? [], [draftsData?.drafts]);
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  );
  const selectedDraft = selected
    ? drafts.find((draft) => draft.inboxItemId === selected.id)
    : undefined;
  const selectedDraftId = selectedDraft?.id ?? null;
  const googleBlocked =
    (dataHealth?.googleAccounts.filter((account) => account.needsReconnect).length ?? 0) > 0;

  const { data: contact } = useQuery<ContactDetail | null>({
    queryKey: ["contact", selected?.contactId],
    enabled: !!selected?.contactId,
    queryFn: async () => {
      if (!selected?.contactId) return null;
      const res = await fetch(`/api/contacts/${selected.contactId}`);
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: draftAudit, isLoading: draftAuditLoading } = useQuery<DraftWorkspaceAudit | null>({
    queryKey: ["draft-workspace-audit", selectedDraftId],
    enabled: !!selectedDraftId,
    queryFn: async () => {
      if (!selectedDraftId) return null;
      const res = await fetch(`/api/drafts/${selectedDraftId}/workspace`);
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const counts = useMemo(() => {
    const ready = items.filter((item) => drafts.some((draft) => draft.inboxItemId === item.id)).length;
    return {
      review: Math.max(items.length - ready, 0),
      ready,
      total: items.length,
    };
  }, [drafts, items]);

  const visibleItems = useMemo(() => {
    if (view === "ready") {
      return items.filter((item) => drafts.some((draft) => draft.inboxItemId === item.id));
    }
    if (view === "needs-review") {
      return items.filter((item) => !drafts.some((draft) => draft.inboxItemId === item.id));
    }
    return items;
  }, [drafts, items, view]);

  const highPriority = visibleItems.filter((item) => item.priority === "high");
  const earlier = visibleItems.filter((item) => item.priority !== "high");

  const invalidateWorkflow = () => {
    queryClient.invalidateQueries({ queryKey: ["reply-queue-bootstrap"] });
    queryClient.invalidateQueries({ queryKey: ["source-status", "google"] });
    queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
    queryClient.invalidateQueries({ queryKey: ["drafts"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["draft-workspace-audit"] });
  };

  const syncMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/gmail/sync", { method: "POST" });
      await fetch("/api/gmail/extract-actions", { method: "POST" });
    },
    onSuccess: () => {
      invalidateWorkflow();
      toast("Synced Gmail and refreshed the queue");
    },
    onError: () => toast.error("Sync failed"),
  });

  const updateDraft = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const res = await fetch(`/api/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit", content }),
      });
      if (!res.ok) throw new Error("Failed to update draft");
      return res.json();
    },
    onSuccess: () => {
      invalidateWorkflow();
      toast.success("Draft updated");
    },
    onError: (err) => toast.error(err.message),
  });

  const saveToGmail = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/drafts/${id}/save-to-gmail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to save Gmail draft");
      return body as { deepLinkUrl?: string };
    },
    onSuccess: (data) => {
      invalidateWorkflow();
      toast.success("Saved to Gmail drafts");
      if (data.deepLinkUrl) window.open(data.deepLinkUrl, "_blank", "noopener,noreferrer");
    },
    onError: (err) => toast.error(err.message),
  });

  const sendGmail = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/drafts/${id}/send-gmail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to send Gmail draft");
      return body;
    },
    onSuccess: () => {
      invalidateWorkflow();
      toast.success("Sent with Gmail");
    },
    onError: (err) => toast.error(err.message),
  });

  const resolveMutation = useMutation({
    mutationFn: async (item: InboxItemData) => {
      const res = await fetch(`/api/inbox-items/${encodeURIComponent(item.id)}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: item.channel }),
      });
      if (!res.ok) throw new Error("Failed to resolve item");
    },
    onSuccess: () => {
      invalidateWorkflow();
      toast.success("Inbox item resolved");
    },
    onError: (err) => toast.error(err.message),
  });

  const markNoReplyMutation = useMutation({
    mutationFn: async (item: InboxItemData) => {
      const res = await fetch(`/api/inbox-items/${encodeURIComponent(item.id)}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ needsResponse: false }),
      });
      if (!res.ok) throw new Error("Failed to label item");
    },
    onSuccess: () => {
      invalidateWorkflow();
      toast("Marked as no reply needed");
    },
    onError: (err) => toast.error(err.message),
  });

  const createDraftMutation = useMutation({
    mutationFn: async (item: InboxItemData) => {
      const res = await fetch("/api/drafts/workspace/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inboxItemId: item.id,
          context: "reply_email",
          tone: "warm",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to generate draft");
      return body as { id: string; existing?: boolean };
    },
    onSuccess: (data) => {
      invalidateWorkflow();
      toast.success(
        data.existing
          ? "Existing draft loaded"
          : "Draft generated from the full thread context",
      );
    },
    onError: (err) => toast.error(err.message),
  });

  const status = statusFor(selectedDraft, googleBlocked);
  const selectedColor = getAvatarColor(selected?.contactName ?? contact?.name ?? "Unknown");
  const isLoading = bootstrapLoading;
  const selectedCanGenerateDraft = selected
    ? ["email", "gmail"].includes(selected.channel.toLowerCase())
    : false;
  const generateDisabled =
    !selected ||
    !!selectedDraft ||
    !selectedCanGenerateDraft ||
    googleBlocked ||
    createDraftMutation.isPending;

  return (
    <div className="reply-console -mx-4 -my-6 min-h-[calc(100vh-6rem)] overflow-hidden border-y sm:-mx-8 sm:-my-10 lg:-mx-10">
      <div className="grid min-h-[calc(100vh-6rem)] grid-cols-1 bg-[#FAF8F5] lg:grid-cols-[360px_minmax(0,1fr)_292px]">
        <section className="border-b border-[#E9E1D5] bg-[#F6F2EC] lg:border-b-0 lg:border-r">
          <header className="border-b border-[#E9E1D5] px-4 py-4 sm:px-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[#B5613F]">
                  Inbox operations
                </div>
                <h1 className="ds-display-md mt-1 text-[30px] font-normal text-[#1B1A17]">
                  Replies
                </h1>
                <p className="mt-1 text-[12px] leading-5 text-[#8A8276]">
                  Triage inbound Gmail and review drafts before anything sends.
                </p>
                {bootstrapUpdatedAt > 0 && (
                  <p className="mt-1 text-[11px] leading-4 text-[#A1998C]">
                    Updated {formatDistanceToNow(new Date(bootstrapUpdatedAt))}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void refetchBootstrap()}
                  disabled={bootstrapFetching && !bootstrapLoading}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-[#E2D9CB] bg-white px-2.5 text-[11.5px] font-semibold text-[#6F685D]"
                >
                  {bootstrapFetching && !bootstrapLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-[#1E1B16] px-2.5 text-[11.5px] font-semibold text-white shadow-[0_1px_2px_rgba(31,26,18,0.14)]"
                >
                  {syncMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Sync Gmail
                </button>
              </div>
            </div>

            <div className="mt-4 flex w-fit gap-1 rounded-[9px] bg-[#ECE5D9] p-1">
              <QueueFilter active={view === "all"} onClick={() => setView("all")}>
                All {counts.total}
              </QueueFilter>
              <QueueFilter active={view === "needs-review"} onClick={() => setView("needs-review")}>
                Review {counts.review}
              </QueueFilter>
              <QueueFilter active={view === "ready"} onClick={() => setView("ready")}>
                Ready {counts.ready}
              </QueueFilter>
            </div>
          </header>

          <div className="max-h-[42vh] overflow-y-auto px-2 py-2 lg:max-h-none lg:h-[calc(100vh-14rem)]">
            {isLoading ? (
              <div className="flex items-center gap-2 px-3 py-6 text-[12px] text-[#8A8276]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading reply queue...
              </div>
            ) : visibleItems.length === 0 ? (
              <EmptyQueue />
            ) : (
              <>
                {highPriority.length > 0 && (
                  <QueueGroup
                    label="High priority"
                    items={highPriority}
                    selectedId={selected?.id}
                    drafts={drafts}
                    onSelect={setSelectedId}
                  />
                )}
                {earlier.length > 0 && (
                  <QueueGroup
                    label={highPriority.length > 0 ? "Earlier" : "Up next"}
                    items={earlier}
                    selectedId={selected?.id}
                    drafts={drafts}
                    onSelect={setSelectedId}
                  />
                )}
              </>
            )}
          </div>
        </section>

        <section className="flex min-w-0 flex-col bg-[#FAF8F5]">
          {selected ? (
            <>
              <header className="flex items-center gap-3 border-b border-[#E9E1D5] px-4 py-4 sm:px-6">
                <AvatarCircle name={selected.contactName} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="ds-display-md truncate text-[18px] text-[#1B1A17]">
                      {selected.contactName}
                    </span>
                    <span className="rounded-[5px] bg-[#EFE7DA] px-2 py-0.5 text-[10.5px] text-[#7C6A55]">
                      {relationshipLabel(contact, selected)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[12px] text-[#8A8276]">
                    {subjectText(selected)}
                  </p>
                </div>
                <span
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[11.5px] font-semibold"
                  style={{ color: status.text, backgroundColor: status.bg }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.text }} />
                  {status.label}
                </span>
              </header>

              <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                <div className="mx-auto flex max-w-3xl flex-col gap-4">
                  <section>
                    <SectionKicker label="Inbound" meta={formatDistanceToNow(new Date(selected.triggerAt))} />
                    <div className="whitespace-pre-line rounded-[10px] border border-[#E9E1D5] bg-[#F3EEE6] px-4 py-3 text-[13px] leading-[1.62] text-[#36332D]">
                      {previewText(selected)}
                    </div>
                  </section>

                  <DraftAuditDisclosure
                    selected={selected}
                    selectedDraft={selectedDraft}
                    contact={contact}
                    audit={draftAudit ?? null}
                    isLoading={draftAuditLoading}
                  />

                  <section>
                    <SectionKicker
                      label="Suggested reply"
                      meta={selectedDraft ? "editable" : "no draft generated yet"}
                    />
                    <div className="overflow-hidden rounded-[12px] border border-[#E4DACB] bg-white shadow-[0_6px_18px_rgba(40,30,20,0.06),0_1px_2px_rgba(40,30,20,0.04)]">
                      <div className="flex gap-2 border-b border-[#F0EAE0] px-4 py-3 text-[11.5px] text-[#8A8276]">
                        <span className="text-[#A89F90]">To</span>
                        <span className="min-w-0 truncate text-[#36332D]">
                          {selectedDraft?.contact.email ?? selected.contactEmail ?? "No email on contact"}
                        </span>
                        {selectedDraft?.subjectLine && (
                          <span className="ml-auto hidden max-w-[45%] truncate text-[#A89F90] sm:block">
                            Re: {selectedDraft.subjectLine}
                          </span>
                        )}
                      </div>
                      {selectedDraft ? (
                        <textarea
                          key={selectedDraft.id}
                          ref={draftTextareaRef}
                          defaultValue={selectedDraft.content}
                          className="min-h-[210px] w-full resize-y bg-white px-4 py-4 text-[13px] leading-[1.66] text-[#26241F] outline-none"
                        />
                      ) : (
                        <div className="flex min-h-[210px] flex-col items-center justify-center px-6 py-8 text-center">
                          <Sparkles className="h-5 w-5 text-[#C2B8A6]" />
                          <p className="mt-2 text-[13px] font-medium text-[#36332D]">
                            No draft is attached to this inbox item yet.
                          </p>
                          <p className="mt-1 max-w-sm text-[12px] leading-5 text-[#8A8276]">
                            Generate an email draft from the full Gmail thread, contact context, and voice profile.
                          </p>
                          <ActionButton
                            icon={createDraftMutation.isPending ? Loader2 : Sparkles}
                            label={
                              createDraftMutation.isPending
                                ? "Generating..."
                                : "Generate email draft"
                            }
                            emphasis="warm"
                            spinning={createDraftMutation.isPending}
                            disabled={generateDisabled}
                            title={
                              selectedCanGenerateDraft
                                ? "Generate a reply draft from the full conversation"
                                : "Only Gmail/email reply items can generate email drafts"
                            }
                            onClick={() => {
                              if (selected) createDraftMutation.mutate(selected);
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </div>

              <footer className="flex flex-wrap items-center gap-2 border-t border-[#E9E1D5] bg-[#F6F2EC] px-4 pb-[calc(4.75rem+var(--safe-bottom))] pt-3 sm:px-6 sm:pb-3">
                <ActionButton
                  icon={selectedDraft ? ArrowUpRight : createDraftMutation.isPending ? Loader2 : Sparkles}
                  label={
                    selectedDraft
                      ? "Open workspace"
                      : createDraftMutation.isPending
                        ? "Generating..."
                        : "Generate draft"
                  }
                  spinning={!selectedDraft && createDraftMutation.isPending}
                  disabled={!selectedDraft && generateDisabled}
                  title={
                    selectedDraft
                      ? "Open the full draft workspace"
                      : "Generate a reply draft from the full Gmail conversation"
                  }
                  onClick={() => {
                    if (selectedDraft) {
                      window.location.href = `/drafts/${selectedDraft.id}/compose`;
                      return;
                    }
                    if (selected) createDraftMutation.mutate(selected);
                  }}
                />
                <ActionButton
                  icon={Ban}
                  label="No reply needed"
                  onClick={() => markNoReplyMutation.mutate(selected)}
                  disabled={markNoReplyMutation.isPending}
                />
                <div className="ml-0 flex flex-wrap gap-2 sm:ml-auto">
                  {selectedDraft && (
                    <ActionButton
                      icon={Check}
                      label="Save edit"
                      onClick={() =>
                        updateDraft.mutate({
                          id: selectedDraft.id,
                          content: draftTextareaRef.current?.value ?? selectedDraft.content,
                        })
                      }
                      disabled={updateDraft.isPending}
                    />
                  )}
                  <ActionButton
                    icon={Mail}
                    label={selectedDraft?.gmailDraftId ? "Open Gmail draft" : "Save to Gmail"}
                    emphasis="warm"
                    disabled={!selectedDraft || saveToGmail.isPending || googleBlocked}
                    onClick={() => {
                      if (!selectedDraft) return;
                      if (selectedDraft.gmailDraftId) {
                        window.open(
                          `https://mail.google.com/mail/u/0/#drafts/${selectedDraft.gmailDraftId}`,
                          "_blank",
                          "noopener,noreferrer",
                        );
                        return;
                      }
                      saveToGmail.mutate(selectedDraft.id);
                    }}
                  />
                  <ActionButton
                    icon={Send}
                    label="Review & send"
                    emphasis="dark"
                    disabled={!selectedDraft || sendGmail.isPending || googleBlocked}
                    onClick={() => {
                      if (!selectedDraft) return;
                      const ok = window.confirm(
                        `Send this Gmail draft to ${selectedDraft.contact.email ?? selected.contactEmail ?? selected.contactName}?`,
                      );
                      if (ok) sendGmail.mutate(selectedDraft.id);
                    }}
                  />
                  <ActionButton
                    icon={CheckCircle2}
                    label="Resolve"
                    onClick={() => resolveMutation.mutate(selected)}
                    disabled={resolveMutation.isPending}
                  />
                </div>
              </footer>
            </>
          ) : (
            <div className="flex min-h-[420px] flex-1 flex-col items-center justify-center px-6 text-center">
              <Inbox className="h-8 w-8 text-[#C2B8A6]" />
              <h2 className="ds-display-md mt-3 text-[22px] text-[#1B1A17]">No replies waiting</h2>
              <p className="mt-1 max-w-sm text-[13px] leading-5 text-[#8A8276]">
                When Gmail finds messages that need a response, they will appear here for review.
              </p>
            </div>
          )}
        </section>

        <aside className="border-t border-[#E9E1D5] bg-[#F3EEE6] lg:border-l lg:border-t-0">
          <ContextDrawer
            selected={selected}
            contact={contact}
            color={selectedColor.bg}
            textColor={selectedColor.text}
            googleBlocked={googleBlocked}
            lastSyncedAt={dataHealth?.googleAccounts.find((account) => account.lastSyncedAt)?.lastSyncedAt ?? null}
          />
        </aside>
      </div>
    </div>
  );
}

function QueueFilter({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[6px] px-3 py-1 text-[11.5px] transition",
        active ? "bg-[#FAF8F5] font-semibold text-[#1B1A17] shadow-sm" : "text-[#6F685D]",
      )}
    >
      {children}
    </button>
  );
}

function QueueGroup({
  label,
  items,
  selectedId,
  drafts,
  onSelect,
}: {
  label: string;
  items: InboxItemData[];
  selectedId?: string;
  drafts: Draft[];
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#A89F90]">
        {label}
      </div>
      <div className="space-y-1">
        {items.map((item) => {
          const isSelected = item.id === selectedId;
          const draft = drafts.find((candidate) => candidate.inboxItemId === item.id);
          const color = getAvatarColor(item.contactName);
          const status = draft ? STATUS_STYLES.ready : STATUS_STYLES.review;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className="w-full rounded-[10px] border px-3 py-3 text-left transition"
              style={{
                borderColor: isSelected ? "#E2D6C2" : "transparent",
                backgroundColor: isSelected ? "#FFFFFF" : "transparent",
                boxShadow: isSelected ? "0 1px 2px rgba(40,30,20,.05)" : "none",
              }}
            >
              <div className="flex gap-2.5">
                <span
                  className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                  style={{ backgroundColor: color.bg, color: color.text }}
                >
                  {getInitials(item.contactName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-[#1B1A17]">
                      {item.contactName}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-[#9A9183]">
                      {formatDistanceToNow(new Date(item.triggerAt))}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[10.5px] text-[#9A6A4B]">
                    {priorityLabel(item)}
                  </span>
                  <span className="mt-1 block truncate text-[12px] font-medium text-[#36332D]">
                    {subjectText(item)}
                  </span>
                  <span className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold" style={{ color: status.text }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.text }} />
                    {status.label}
                  </span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AvatarCircle({ name, size = "sm" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const color = getAvatarColor(name);
  const sizeClass = size === "lg" ? "h-10 w-10 text-[14px]" : size === "md" ? "h-[34px] w-[34px] text-[12.5px]" : "h-8 w-8 text-[11px]";
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold shadow-sm", sizeClass)}
      style={{ backgroundColor: color.bg, color: color.text }}
    >
      {getInitials(name)}
    </span>
  );
}

function SectionKicker({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#A89F90]">
        {label}
      </span>
      {meta && <span className="text-[11px] text-[#9A9183]">- {meta}</span>}
    </div>
  );
}

function EvidenceTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-[#DCE3D8] bg-[#FAF8F5]/60 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7E8B66]">
        {label}
      </div>
      <div className="mt-0.5 text-[12px] font-semibold text-[#4F5A3E]">{value}</div>
    </div>
  );
}

function DraftAuditDisclosure({
  selected,
  selectedDraft,
  contact,
  audit,
  isLoading,
}: {
  selected: InboxItemData;
  selectedDraft: Draft | undefined;
  contact: ContactDetail | null | undefined;
  audit: DraftWorkspaceAudit | null;
  isLoading: boolean;
}) {
  const replyContext = audit?.context.replyContext ?? null;
  const latestInbound = replyContext?.latestInbound ?? null;
  const references = audit?.context.references ?? [];
  const recentThread = replyContext?.threadHistory.slice(-4) ?? [];
  const bodyText = latestInbound?.body.trim() ? latestInbound.body : previewText(selected);
  const bodySource = latestInbound
    ? latestInbound.bodyIsFull
      ? "Full Gmail body"
      : "Snippet fallback"
    : selectedDraft
      ? "Workspace unavailable"
      : "Queue preview";
  const missingContext = buildMissingContextItems({
    selected,
    selectedDraft,
    contact,
    audit,
  });

  return (
    <details className="rounded-[10px] border border-[#DCE3D8] bg-[#EDF0EC] px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[11.5px] leading-5 text-[#4F5A3E]">
        <Sparkles className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <strong className="font-semibold">Draft context</strong>{" "}
          {selectedDraft
            ? "shows the message, thread depth, voice sources, and gaps"
            : "will load exact provenance after a draft is generated"}
        </span>
        <span className="ml-auto rounded-[6px] border border-[#CBD4C2] px-2 py-0.5 text-[11px] font-semibold">
          Audit
        </span>
      </summary>

      <div className="mt-3 grid gap-2 text-[12px] text-[#4F5A3E] sm:grid-cols-2 xl:grid-cols-4">
        <EvidenceTile label="Inbound" value={bodySource} />
        <EvidenceTile
          label="Thread"
          value={`${replyContext?.threadHistory.length ?? selected.messageCount} message${
            (replyContext?.threadHistory.length ?? selected.messageCount) === 1 ? "" : "s"
          }`}
        />
        <EvidenceTile
          label="Voice"
          value={
            selectedDraft && isLoading
              ? "loading"
              : `${references.length} source${references.length === 1 ? "" : "s"}`
          }
        />
        <EvidenceTile label="Facts" value={`${contact?.personFacts?.length ?? 0} available`} />
      </div>

      {isLoading ? (
        <div className="mt-3 flex items-center gap-2 rounded-[8px] border border-[#DCE3D8] bg-[#FAF8F5]/70 px-3 py-2 text-[12px] text-[#647052]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading exact draft context...
        </div>
      ) : (
        <div className="mt-3 grid gap-3">
          <div className="rounded-[9px] border border-[#DCE3D8] bg-[#FAF8F5]/70 px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7E8B66]">
                Message used
              </span>
              <span className="rounded-[6px] bg-[#E5EBDD] px-2 py-0.5 text-[10.5px] font-semibold text-[#647052]">
                {bodySource}
              </span>
            </div>
            {latestInbound && (
              <div className="mt-2 space-y-1 text-[11.5px] text-[#6A715F]">
                <div className="truncate">
                  From {latestInbound.fromName ?? latestInbound.fromEmail} ·{" "}
                  {formatDistanceToNow(new Date(latestInbound.occurredAt))}
                </div>
                <div className="truncate">Subject: {latestInbound.subject ?? "No subject"}</div>
              </div>
            )}
            <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-line text-[12px] leading-[1.62] text-[#34382D]">
              {truncateText(bodyText, 900)}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[9px] border border-[#DCE3D8] bg-[#FAF8F5]/70 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7E8B66]">
                Thread loaded
              </div>
              {recentThread.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {recentThread.map((message, index) => (
                    <div
                      key={`${message.direction}-${message.occurredAt}-${index}`}
                      className="border-t border-[#E1E7DB] pt-2 first:border-t-0 first:pt-0"
                    >
                      <div className="flex items-center gap-2 text-[10.5px] font-semibold text-[#647052]">
                        <span>{message.direction === "OUTBOUND" ? "You" : message.fromName ?? message.fromEmail}</span>
                        <span className="text-[#9AA58E]">
                          {formatDistanceToNow(new Date(message.occurredAt))}
                        </span>
                      </div>
                      <p className="mt-1 text-[11.5px] leading-5 text-[#4B5143]">
                        {truncateText(message.snippet ?? message.subject ?? "No preview available.", 170)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11.5px] leading-5 text-[#6A715F]">
                  Generate a draft to show the loaded Gmail thread here.
                </p>
              )}
            </div>

            <div className="rounded-[9px] border border-[#DCE3D8] bg-[#FAF8F5]/70 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7E8B66]">
                Voice sources
              </div>
              {references.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {references.slice(0, 4).map((reference) => (
                    <div key={reference.id} className="border-t border-[#E1E7DB] pt-2 first:border-t-0 first:pt-0">
                      <div className="truncate text-[11.5px] font-semibold text-[#4B5143]">
                        {reference.filename}
                      </div>
                      <div className="mt-0.5 text-[10.5px] uppercase tracking-[0.06em] text-[#9AA58E]">
                        {humanizeKey(reference.sourceType)}
                      </div>
                      {reference.toneNotes && (
                        <p className="mt-1 text-[11.5px] leading-5 text-[#6A715F]">
                          {truncateText(reference.toneNotes, 150)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11.5px] leading-5 text-[#6A715F]">
                  {selectedDraft
                    ? "No uploaded voice reference materials matched this draft."
                    : "Voice sources appear after a draft is generated."}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-[9px] border border-[#DCE3D8] bg-[#FAF8F5]/70 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7E8B66]">
              Known gaps
            </div>
            <ul className="mt-2 space-y-1.5">
              {missingContext.map((item) => (
                <li key={item} className="flex gap-2 text-[11.5px] leading-5 text-[#4B5143]">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#9AA58E]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </details>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  title,
  emphasis = "plain",
  spinning = false,
}: {
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  emphasis?: "plain" | "warm" | "dark";
  spinning?: boolean;
}) {
  const style =
    emphasis === "dark"
      ? "border-transparent bg-gradient-to-b from-[#2C2823] to-[#1B1A17] text-[#FAF8F5] shadow-[0_1px_2px_rgba(20,12,4,.3)]"
      : emphasis === "warm"
        ? "border-[#E2D2BB] bg-gradient-to-b from-[#F5EDE0] to-[#EBE0CD] text-[#3A352D] shadow-sm"
        : "border-[#E2D9CB] bg-white text-[#6F685D]";

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        style,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", spinning && "animate-spin")} />
      {label}
    </button>
  );
}

function EmptyQueue() {
  return (
    <div className="mx-2 mt-3 rounded-[12px] border border-[#E9E1D5] bg-[#FAF8F5] px-4 py-8 text-center">
      <CheckCircle2 className="mx-auto h-6 w-6 text-[#C2B8A6]" />
      <p className="mt-2 text-[13px] font-semibold text-[#36332D]">Queue is clear</p>
      <p className="mt-1 text-[12px] leading-5 text-[#8A8276]">
        New Gmail items will show up after sync and classification.
      </p>
    </div>
  );
}

function ContextDrawer({
  selected,
  contact,
  color,
  textColor,
  googleBlocked,
  lastSyncedAt,
}: {
  selected: InboxItemData | null;
  contact: ContactDetail | null | undefined;
  color: string;
  textColor: string;
  googleBlocked: boolean;
  lastSyncedAt: string | null;
}) {
  const facts = contact?.personFacts ?? [];
  const contextHighlights = buildContextHighlights(contact);
  const nonEmailFacts = facts.filter((fact) => fact.type !== "email_address");
  const emailFacts = facts.filter((fact) => fact.type === "email_address");
  const interactions = contact?.interactions ?? [];
  const circle = contact?.circles?.[0]?.circle?.name ?? "Unassigned";
  const name = selected?.contactName ?? contact?.name ?? "No selection";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-[#E9E1D5] px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold"
            style={{ backgroundColor: color, color: textColor }}
          >
            {getInitials(name)}
          </span>
          <div className="min-w-0">
            <div className="ds-display-md truncate text-[16px] text-[#1B1A17]">{name}</div>
            <div className="mt-0.5 truncate text-[11px] text-[#8A8276]">
              {relationshipLabel(contact, selected)}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <ContextMetric
            label="Last contact"
            value={
              contact?.lastInteraction
                ? formatDistanceToNow(new Date(contact.lastInteraction))
                : selected?.triggerAt
                  ? formatDistanceToNow(new Date(selected.triggerAt))
                  : "Unknown"
            }
          />
          <ContextMetric label="Circle" value={circle} />
        </div>

        <div
          className="mt-4 flex items-center gap-2 rounded-[8px] border px-3 py-2 text-[11.5px]"
          style={{
            color: googleBlocked ? "#7A4F3C" : "#5E6B47",
            backgroundColor: googleBlocked ? "#F0E5DC" : "#EDF0EC",
            borderColor: googleBlocked ? "#E4D0C4" : "#DCE3D8",
          }}
        >
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: googleBlocked ? "#7A4F3C" : "#7D9061" }} />
          <span className="min-w-0 flex-1 truncate">
            {googleBlocked
              ? "Gmail needs reconnect"
              : lastSyncedAt
                ? `Gmail synced ${formatDistanceToNow(new Date(lastSyncedAt))}`
                : "Gmail source available"}
          </span>
        </div>
      </div>

      <div className="border-b border-[#E9E1D5] px-5 py-4">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#A89F90]">
          What we know
        </div>
        {contextHighlights.length > 0 || nonEmailFacts.length > 0 ? (
          <div className="space-y-2">
            {contextHighlights.slice(0, 5).map((highlight) => (
              <div key={highlight} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#9A6A4B]" />
                <span className="text-[12px] leading-5 text-[#3D3A33]">{highlight}</span>
              </div>
            ))}
            {nonEmailFacts.slice(0, Math.max(0, 5 - contextHighlights.length)).map((fact) => (
              <div key={fact.id} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#C2A27F]" />
                <span className="text-[12px] leading-5 text-[#3D3A33]">{fact.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] leading-5 text-[#8A8276]">
            No synthesized context yet. Recent interactions below are still used for drafting.
          </p>
        )}
        {emailFacts.length > 0 && (
          <div className="mt-3 rounded-[8px] border border-[#E9E1D5] bg-[#FAF8F5] px-3 py-2 text-[11.5px] leading-5 text-[#8A8276]">
            Email on file: {emailFacts[0].value}
          </div>
        )}
      </div>

      <div className="px-5 py-4">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#A89F90]">
          Recent interactions
        </div>
        {interactions.length > 0 ? (
          <div className="relative pl-4">
            <div className="absolute bottom-1 left-[3px] top-1 w-px bg-[#E2D9CB]" />
            {interactions.slice(0, 5).map((interaction) => (
              <div key={interaction.id} className="relative mb-4">
                <span className="absolute -left-4 top-1 h-2 w-2 rounded-full border-2 border-[#F3EEE6] bg-[#C9BDA8]" />
                <div className="text-[10.5px] text-[#A89F90]">
                  {formatDistanceToNow(new Date(interaction.occurredAt))}
                </div>
                <div className="mt-0.5 text-[12px] leading-5 text-[#3D3A33]">
                  {interaction.summary ?? interaction.subject ?? interaction.type}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] leading-5 text-[#8A8276]">
            No interaction history is attached to this contact yet.
          </p>
        )}
        {selected?.contactId && (
          <Link
            href={`/people`}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-[7px] border border-[#E2D9CB] bg-[#FAF8F5] px-3 py-2 text-[11.5px] font-semibold text-[#6F685D]"
          >
            Open people view
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

function buildContextHighlights(contact: ContactDetail | null | undefined): string[] {
  if (!contact) return [];
  const highlights: string[] = [];

  if (contact.memory?.recurringThemes?.length) {
    highlights.push(`Recurring themes: ${contact.memory.recurringThemes.slice(0, 4).join(", ")}`);
  }

  const openThreads = asRecordArray(contact.memory?.openThreads);
  for (const thread of openThreads.slice(0, 2)) {
    const subject = stringValue(thread.subject) ?? stringValue(thread.topic) ?? stringValue(thread.context);
    const status = stringValue(thread.status);
    if (subject) highlights.push(`Open thread: ${subject}${status ? ` (${status})` : ""}`);
  }

  const mentioned = asRecordArray(contact.memory?.theyMentioned);
  for (const item of mentioned.slice(0, 2)) {
    const subject = stringValue(item.subject) ?? stringValue(item.topic);
    const context = stringValue(item.context) ?? stringValue(item.detail);
    if (subject && context) highlights.push(`${subject}: ${context}`);
    else if (context) highlights.push(context);
  }

  const personalContext = asPlainRecord(contact.memory?.personalContext);
  for (const [key, value] of Object.entries(personalContext).slice(0, 3)) {
    const rendered = renderUnknownValue(value);
    if (rendered) highlights.push(`${humanizeKey(key)}: ${rendered}`);
  }

  if (contact.profile?.expertiseAreas?.length) {
    highlights.push(`Expertise: ${contact.profile.expertiseAreas.slice(0, 4).join(", ")}`);
  }
  if (contact.profile?.relationshipStage) {
    highlights.push(`Relationship stage: ${humanizeKey(contact.profile.relationshipStage)}`);
  }

  return Array.from(new Set(highlights)).slice(0, 8);
}

function buildMissingContextItems({
  selected,
  selectedDraft,
  contact,
  audit,
}: {
  selected: InboxItemData;
  selectedDraft: Draft | undefined;
  contact: ContactDetail | null | undefined;
  audit: DraftWorkspaceAudit | null;
}): string[] {
  const gaps: string[] = [];
  const latestInbound = audit?.context.replyContext?.latestInbound ?? null;

  if (!selectedDraft) {
    gaps.push("Generate the draft to load exact Gmail thread and voice provenance before saving.");
  } else if (!audit) {
    gaps.push("Workspace audit did not load; open the draft workspace before sending.");
  }

  if (audit && !audit.context.replyContext) {
    gaps.push("Full Gmail thread context was not available for this draft.");
  }

  if (latestInbound && !latestInbound.bodyIsFull) {
    gaps.push("Only a snippet was available for the latest inbound email.");
  }

  if (audit && audit.context.references.length === 0) {
    gaps.push("No uploaded voice reference materials matched this draft.");
  }

  const nonEmailFactCount =
    contact?.personFacts?.filter((fact) => fact.type !== "email_address").length ?? 0;
  if (audit && !hasMemorySnapshot(audit.context.memory) && nonEmailFactCount === 0) {
    gaps.push("No saved relationship memory or non-email contact facts were available.");
  }

  if (!selected.contactEmail && !selectedDraft?.contact.email) {
    gaps.push("No recipient email is on file.");
  }

  if (gaps.length === 0) {
    gaps.push("No obvious context gaps; still review the exact draft before saving to Gmail.");
  }

  return gaps;
}

function hasMemorySnapshot(memory: MemorySnapshot | null | undefined): boolean {
  if (!memory) return false;
  if (memory.recurringThemes.length > 0 || memory.openThreads.length > 0) return true;
  return Object.keys(asPlainRecord(memory.personalContext)).length > 0;
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed || "No preview available.";
  return `${trimmed.slice(0, maxLength - 3).trim()}...`;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isPlainRecord(item))
    : [];
}

function asPlainRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function renderUnknownValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const items = value.map(renderUnknownValue).filter((item): item is string => Boolean(item));
    return items.length > 0 ? items.slice(0, 3).join(", ") : null;
  }
  if (isPlainRecord(value)) {
    const parts = Object.entries(value)
      .map(([key, nested]) => {
        const rendered = renderUnknownValue(nested);
        return rendered ? `${humanizeKey(key)}: ${rendered}` : null;
      })
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.slice(0, 2).join("; ") : null;
  }
  return null;
}

function humanizeKey(value: string): string {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function ContextMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-[#E9E1D5] bg-[#FAF8F5] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#A89F90]">
        {label}
      </div>
      <div className="mt-0.5 truncate text-[12.5px] font-semibold text-[#36332D]">{value}</div>
    </div>
  );
}
