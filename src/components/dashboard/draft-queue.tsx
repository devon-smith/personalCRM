"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  FileEdit,
  Copy,
  Mail,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Send,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "@/lib/date-utils";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { useDraftComposer } from "@/lib/draft-composer-context";

interface DraftContact {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly company: string | null;
  readonly avatarUrl: string | null;
}

interface Draft {
  readonly id: string;
  readonly type: string;
  readonly tone: string;
  readonly content: string;
  readonly subjectLine: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly contact: DraftContact;
}

const TYPE_LABELS: Record<string, string> = {
  REPLY_EMAIL: "Reply",
  CATCHING_UP: "Catch up",
  CONGRATULATE: "Congrats",
  ASK: "Ask",
  FOLLOW_UP: "Follow up",
};

export function DraftQueue() {
  const queryClient = useQueryClient();
  const { openComposer } = useDraftComposer();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ drafts: Draft[] }>({
    queryKey: ["drafts", "DRAFT"],
    queryFn: async () => {
      const res = await fetch("/api/drafts?status=DRAFT");
      if (!res.ok) throw new Error("Failed to fetch drafts");
      return res.json();
    },
  });

  const updateDraft = useMutation({
    mutationFn: async ({ id, action, content }: { id: string; action: string; content?: string }) => {
      const res = await fetch(`/api/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, content }),
      });
      if (!res.ok) throw new Error("Failed to update draft");
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["drafts"] });
      if (variables.action === "send") {
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        toast.success("Marked as sent");
      }
      if (variables.action === "discard") {
        toast("Draft discarded");
      }
      if (variables.action === "edit") {
        setEditingId(null);
        toast.success("Draft updated");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const copyDraft = useCallback(async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const openEmail = useCallback((contact: DraftContact, content: string, subject: string | null) => {
    if (!contact.email) {
      toast.error("No email on file for this contact");
      return;
    }
    const params = new URLSearchParams();
    if (subject) params.set("subject", subject);
    params.set("body", content);
    window.open(`mailto:${contact.email}?${params.toString()}`);
  }, []);

  const startEditing = useCallback((draft: Draft) => {
    setEditingId(draft.id);
    setEditContent(draft.content);
    setExpandedId(draft.id);
  }, []);

  const drafts = data?.drafts ?? [];
  const hasDrafts = drafts.length > 0;

  return (
    <div className="crm-animate-enter">
      <div className="flex items-center justify-between">
        <h3 className="ds-heading-sm">Draft queue</h3>
        <button
          className="flex items-center gap-1.5 text-[12px] font-medium transition-colors"
          style={{ color: "var(--text-tertiary)", transitionDuration: "var(--duration-fast)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent-color)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
          onClick={() => openComposer()}
        >
          <FileEdit className="h-3 w-3" />
          New draft
        </button>
      </div>

      {isLoading ? (
        <div className="mt-4 flex items-center gap-2 ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading...
        </div>
      ) : !hasDrafts ? (
        <div
          className="mt-4 rounded-[12px] px-4 py-6 text-center"
          style={{ backgroundColor: "var(--surface-sunken)" }}
        >
          <FileEdit className="mx-auto h-5 w-5" style={{ color: "var(--border-strong)" }} />
          <p className="mt-2 ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
            No pending drafts.
          </p>
          <button
            className="mt-1 ds-caption font-medium transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onClick={() => openComposer()}
          >
            Draft a message
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-1">
          {drafts.map((draft) => {
            const isExpanded = expandedId === draft.id;
            const isEditing = editingId === draft.id;
            const color = getAvatarColor(draft.contact.name);

            return (
              <div
                key={draft.id}
                className="rounded-[10px] transition-colors"
                style={{
                  backgroundColor: isExpanded ? "var(--surface-sunken)" : "",
                  transitionDuration: "var(--duration-fast)",
                }}
              >
                {/* Summary row */}
                <button
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left rounded-[10px] transition-colors"
                  style={{ transitionDuration: "var(--duration-fast)" }}
                  onMouseEnter={(e) => {
                    if (!isExpanded) e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isExpanded) e.currentTarget.style.backgroundColor = "";
                  }}
                  onClick={() => setExpandedId(isExpanded ? null : draft.id)}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback
                      className="text-[10px] font-semibold"
                      style={{ backgroundColor: color.bg, color: color.text }}
                    >
                      {getInitials(draft.contact.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="ds-body-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                        {draft.contact.name}
                      </span>
                      <span
                        className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[9px] font-semibold"
                        style={{ backgroundColor: "var(--accent-color-10)", color: "var(--accent-color)" }}
                      >
                        {TYPE_LABELS[draft.type] ?? draft.type}
                      </span>
                    </div>
                    <p className="ds-caption truncate mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                      {draft.content.slice(0, 80)}{draft.content.length > 80 ? "..." : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {formatDistanceToNow(new Date(draft.createdAt))}
                  </span>
                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-tertiary)" }} />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-tertiary)" }} />
                  )}
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-3 pb-3">
                    {/* Subject line */}
                    {draft.subjectLine && (
                      <div className="mb-2 ml-11">
                        <span className="ds-caption" style={{ color: "var(--text-tertiary)" }}>Subject: </span>
                        <span className="ds-caption font-medium" style={{ color: "var(--text-secondary)" }}>
                          {draft.subjectLine}
                        </span>
                      </div>
                    )}

                    {/* Draft body */}
                    <div className="ml-11">
                      {isEditing ? (
                        <div>
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows={5}
                            className="w-full rounded-[8px] p-3 ds-body-sm leading-relaxed resize-none focus:outline-none focus:ring-1"
                            style={{
                              backgroundColor: "var(--background)",
                              color: "var(--text-primary)",
                              borderColor: "var(--border)",
                              border: "1px solid var(--border)",
                            }}
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              className="flex items-center gap-1 rounded-[6px] px-2.5 py-1.5 text-[11px] font-medium transition-colors"
                              style={{ backgroundColor: "var(--accent-color)", color: "white" }}
                              onClick={() => updateDraft.mutate({ id: draft.id, action: "edit", content: editContent })}
                              disabled={updateDraft.isPending}
                            >
                              <Check className="h-3 w-3" /> Save
                            </button>
                            <button
                              className="rounded-[6px] px-2.5 py-1.5 text-[11px] font-medium transition-colors"
                              style={{ color: "var(--text-tertiary)" }}
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="rounded-[8px] p-3 whitespace-pre-wrap ds-body-sm leading-relaxed"
                          style={{ backgroundColor: "var(--background)", color: "var(--text-primary)" }}
                        >
                          {draft.content}
                        </div>
                      )}

                      {/* Actions */}
                      {!isEditing && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <ActionButton
                            icon={copiedId === draft.id ? Check : Copy}
                            label={copiedId === draft.id ? "Copied" : "Copy"}
                            onClick={() => copyDraft(draft.id, draft.content)}
                          />
                          <ActionButton
                            icon={Mail}
                            label="Email"
                            onClick={() => openEmail(draft.contact, draft.content, draft.subjectLine)}
                          />
                          <ActionButton
                            icon={FileEdit}
                            label="Edit"
                            onClick={() => startEditing(draft)}
                          />
                          <ActionButton
                            icon={Send}
                            label="Mark sent"
                            onClick={() => updateDraft.mutate({ id: draft.id, action: "send" })}
                            disabled={updateDraft.isPending}
                          />
                          <ActionButton
                            icon={X}
                            label="Discard"
                            onClick={() => updateDraft.mutate({ id: draft.id, action: "discard" })}
                            disabled={updateDraft.isPending}
                            variant="danger"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  variant,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "danger";
}) {
  return (
    <button
      className="flex items-center gap-1 rounded-[6px] px-2 py-1.5 text-[11px] font-medium transition-colors"
      style={{
        backgroundColor: "var(--surface-sunken)",
        color: variant === "danger" ? "var(--status-urgent)" : "var(--text-secondary)",
        transitionDuration: "var(--duration-fast)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = variant === "danger"
          ? "var(--status-urgent-bg)"
          : "var(--border)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
      }}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}
