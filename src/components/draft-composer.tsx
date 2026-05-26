"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useDraftComposer } from "@/lib/draft-composer-context";
import type { DraftTone, DraftContext } from "@/lib/draft-composer-context";
import { RelationshipTypePill } from "@/components/draft/relationship-type-pill";
import type { RelationshipType } from "@/lib/voice/relationship-classifier";
import { useContacts, useContact, type ContactWithCount } from "@/lib/hooks/use-contacts";
import { useDebounce } from "@/lib/hooks/use-debounce";
import {
  Search,
  X,
  Copy,
  Mail,
  MessageSquare,
  Linkedin,
  RefreshCw,
  Check,
  Loader2,
  ChevronDown,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

interface VoiceContextSummary {
  references: Array<{ id: string; filename: string; sourceType: string }>;
  examples: Array<{ toEmail: string; sentAt: string }>;
  relationshipType: string;
}

interface DraftResult {
  readonly quick: string;
  readonly detailed: string;
  readonly subjectLine: string | null;
  readonly voiceContextUsed?: VoiceContextSummary;
}

interface ReplyPreviewMessage {
  direction: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  occurredAt: string;
}

interface ReplyPreviewData {
  latestInbound: {
    fromEmail: string;
    fromName: string | null;
    subject: string | null;
    body: string;
    bodyIsFull: boolean;
    occurredAt: string;
  };
  threadHistory: ReplyPreviewMessage[];
}

type ComposerStep = "pick_contact" | "configure" | "drafts";

const TONE_OPTIONS: readonly { readonly value: DraftTone; readonly label: string; readonly emoji: string }[] = [
  { value: "casual", label: "Casual", emoji: "💬" },
  { value: "warm", label: "Warm", emoji: "☀️" },
  { value: "professional", label: "Professional", emoji: "💼" },
  { value: "congratulatory", label: "Congrats", emoji: "🎉" },
  { value: "checking_in", label: "Check in", emoji: "👋" },
];

const CONTEXT_OPTIONS: readonly { readonly value: DraftContext; readonly label: string }[] = [
  { value: "reply_email", label: "Reply to email" },
  { value: "catching_up", label: "Catching up" },
  { value: "congratulate", label: "Congratulate" },
  { value: "ask", label: "Ask something" },
  { value: "follow_up", label: "Follow up" },
];

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function DraftComposer() {
  const { isOpen, contactId: presetContactId, presetTone, presetContext, threadSubject, threadSnippet, threadKey, closeComposer } =
    useDraftComposer();

  const [step, setStep] = useState<ComposerStep>("pick_contact");
  const [selectedContact, setSelectedContact] = useState<ContactWithCount | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 200);
  const { data: contacts } = useContacts({ search: debouncedSearch });

  const [tone, setTone] = useState<DraftTone>("warm");
  const [context, setContext] = useState<DraftContext>("catching_up");
  const [contextDetail, setContextDetail] = useState("");
  const [relationshipTypeOverride, setRelationshipTypeOverride] =
    useState<RelationshipType | null>(null);

  const [drafts, setDrafts] = useState<DraftResult | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showDetailed, setShowDetailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savingToGmail, setSavingToGmail] = useState(false);
  const [gmailDeepLink, setGmailDeepLink] = useState<string | null>(null);

  // M0.x.4: "message being replied to" UI. Only the thread expander
  // is local state; the fetched preview comes from React Query so the
  // loading state stays out of useEffect (avoids the cascading-render
  // lint rule and gets dedup for free).
  const [showFullThread, setShowFullThread] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setDrafts(null);
      setDraftId(null);
      setIsGenerating(false);
      setShowDetailed(false);
      setCopied(false);
      setSavingToGmail(false);
      setGmailDeepLink(null);
      setContextDetail("");
      setSearch("");
      setShowFullThread(false);

      if (presetTone) setTone(presetTone);
      else setTone("warm");

      if (presetContext) setContext(presetContext);
      else setContext("catching_up");

      if (presetContactId) {
        // Skip contact picker — we'll resolve the contact
        setStep("configure");
        setSelectedContact(null); // will be resolved below
      } else {
        setStep("pick_contact");
        setSelectedContact(null);
      }
    }
  }, [isOpen, presetContactId, presetTone, presetContext]);

  // Resolve preset contact — fetch the single contact by ID rather than
  // loading the entire contact list (which can be ~30k rows). The result
  // is derived, not state, so we don't fight the picker's own setState.
  const { data: presetContact } = useContact(
    presetContactId && !selectedContact ? presetContactId : null,
  );
  const resolvedPresetContact: ContactWithCount | null = presetContact
    ? ({
        ...presetContact,
        _count: { interactions: presetContact.interactions?.length ?? 0 },
      } as unknown as ContactWithCount)
    : null;
  const effectiveContact: ContactWithCount | null =
    selectedContact ?? resolvedPresetContact;

  // Focus search on contact picker step
  useEffect(() => {
    if (step === "pick_contact" && isOpen) {
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [step, isOpen]);

  // M0.x.4: load the inbound message Jennifer is replying to via
  // React Query — only fires when the dialog is open, in reply mode,
  // and a threadKey is present. React Query handles loading state,
  // dedup, and unmount cancellation so we don't need useEffect.
  const replyQueryEnabled =
    isOpen && context === "reply_email" && !!threadKey;
  const replyQuery = useQuery<{ replyContext: ReplyPreviewData | null }>({
    queryKey: ["reply-context", threadKey],
    enabled: replyQueryEnabled,
    queryFn: async () => {
      const res = await fetch("/api/drafts/reply-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadKey }),
      });
      if (!res.ok) return { replyContext: null };
      return res.json();
    },
    staleTime: 60 * 1000,
  });
  const replyPreview = replyQuery.data?.replyContext ?? null;
  const loadingReplyPreview = replyQueryEnabled && replyQuery.isLoading;

  const selectContact = useCallback((contact: ContactWithCount) => {
    setSelectedContact(contact);
    setStep("configure");
    setSearch("");
    setRelationshipTypeOverride(null); // re-infer for the new contact
  }, []);

  const generateDraft = useCallback(async () => {
    if (!effectiveContact) return;

    setIsGenerating(true);
    setDrafts(null);
    try {
      const res = await fetch("/api/drafts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: effectiveContact.id,
          tone,
          context,
          contextDetail: contextDetail || undefined,
          threadSubject: threadSubject || undefined,
          threadSnippet: threadSnippet || undefined,
          threadKey: threadKey || undefined,
          relationshipTypeOverride: relationshipTypeOverride ?? undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Generation failed");
      }

      const result = (await res.json()) as DraftResult & { draftId?: string };
      setDrafts(result);
      if (result.draftId) setDraftId(result.draftId);
      setGmailDeepLink(null);
      setStep("drafts");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate draft");
    } finally {
      setIsGenerating(false);
    }
  }, [effectiveContact, tone, context, contextDetail, threadSubject, threadSnippet, threadKey, relationshipTypeOverride]);

  const saveToGmail = useCallback(async () => {
    if (!draftId || !effectiveContact) return;
    if (!effectiveContact.email) {
      toast.error("No email on file for this contact");
      return;
    }

    setSavingToGmail(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}/save-to-gmail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientEmail: effectiveContact.email,
          isReply: context === "reply_email",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Save to Gmail failed");
      }
      const { deepLinkUrl } = (await res.json()) as { deepLinkUrl: string };
      setGmailDeepLink(deepLinkUrl);
      toast.success("Saved to Gmail");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save to Gmail");
    } finally {
      setSavingToGmail(false);
    }
  }, [draftId, effectiveContact, context]);

  const copyDraft = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const openEmail = useCallback((text: string, subject: string | null) => {
    if (!effectiveContact?.email) {
      toast.error("No email on file for this contact");
      return;
    }
    const params = new URLSearchParams();
    if (subject) params.set("subject", subject);
    params.set("body", text);
    window.open(`mailto:${effectiveContact.email}?${params.toString()}`);
  }, [effectiveContact]);

  const openLinkedIn = useCallback(() => {
    if (!effectiveContact?.linkedinUrl) {
      toast.error("No LinkedIn URL on file");
      return;
    }
    window.open(effectiveContact.linkedinUrl, "_blank");
  }, [effectiveContact]);

  const filteredContacts = contacts?.slice(0, 8) ?? [];

  const activeDraft = showDetailed ? drafts?.detailed : drafts?.quick;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeComposer()}>
      <DialogContent
        className="sm:max-w-[480px] p-0 gap-0 overflow-hidden"
        style={{ backgroundColor: "var(--background)", border: "1px solid var(--border)" }}
      >
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="ds-heading-sm" style={{ color: "var(--text-primary)" }}>
            {step === "pick_contact" && "Draft a message"}
            {step === "configure" && effectiveContact && `Message ${effectiveContact.name.split(" ")[0]}`}
            {step === "drafts" && "Your draft"}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Contact Picker */}
        {step === "pick_contact" && (
          <div className="px-5 pb-5">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
                style={{ color: "var(--text-tertiary)" }}
              />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contacts..."
                className="pl-10"
                style={{ backgroundColor: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}
              />
            </div>

            <div className="mt-3 max-h-[320px] overflow-y-auto space-y-0.5">
              {filteredContacts.length === 0 && search && (
                <p className="ds-caption py-8 text-center" style={{ color: "var(--text-tertiary)" }}>
                  No contacts found
                </p>
              )}
              {filteredContacts.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => selectContact(contact)}
                  className="w-full flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-sunken)]"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback
                      className="text-xs font-medium"
                      style={{ backgroundColor: "var(--surface-sunken)", color: "var(--text-secondary)" }}
                    >
                      {getInitials(contact.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="ds-body-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                      {contact.name}
                    </p>
                    {(contact.company || contact.email) && (
                      <p className="ds-caption truncate" style={{ color: "var(--text-tertiary)" }}>
                        {contact.company ?? contact.email}
                      </p>
                    )}
                  </div>
                  <span
                    className="ds-caption shrink-0"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {contact._count.interactions} interactions
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Configure Tone + Context */}
        {step === "configure" && !effectiveContact && presetContactId && (
          <div className="px-5 pb-5 flex items-center gap-2" style={{ color: "var(--text-tertiary)" }}>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-[13px]">Loading contact…</span>
          </div>
        )}

        {step === "configure" && effectiveContact && (
          <div className="px-5 pb-5 space-y-5">
            {/* Selected contact card */}
            <div
              className="flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5"
              style={{ backgroundColor: "var(--surface-sunken)" }}
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback
                  className="text-xs font-medium"
                  style={{ backgroundColor: "var(--border)", color: "var(--text-secondary)" }}
                >
                  {getInitials(effectiveContact.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="ds-body-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {effectiveContact.name}
                </p>
                <p className="ds-caption" style={{ color: "var(--text-tertiary)" }}>
                  {[effectiveContact.role, effectiveContact.company].filter(Boolean).join(" at ") || effectiveContact.email || "No details"}
                </p>
              </div>
              {!presetContactId && (
                <button
                  onClick={() => { setStep("pick_contact"); setSelectedContact(null); }}
                  className="p-1 rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--border)]"
                >
                  <X className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
                </button>
              )}
            </div>

            {/* M0.x.4: "Replying to this message" panel. Shows the actual
                inbound body so Jennifer can see what the draft will respond
                to BEFORE generating. Only renders in reply mode with a
                loaded thread. The threadKey guard means stale data left
                over from a prior reply-mode session doesn't accidentally
                appear in non-reply mode. */}
            {context === "reply_email" && !!threadKey && (loadingReplyPreview || replyPreview) && (
              <ReplyingToPanel
                preview={replyPreview}
                loading={loadingReplyPreview}
                showFullThread={showFullThread}
                onToggleThread={() => setShowFullThread((v) => !v)}
              />
            )}

            {/* Relationship-type pill (M6.4) — shows inferred type with
                override dropdown. Hidden by the component itself when
                the contact has no email. */}
            <RelationshipTypePill
              contactId={effectiveContact.id}
              value={relationshipTypeOverride}
              onChange={setRelationshipTypeOverride}
            />

            {/* Tone selector */}
            <div>
              <label className="ds-caption font-medium mb-2 block" style={{ color: "var(--text-secondary)" }}>
                Tone
              </label>
              <div className="flex flex-wrap gap-2">
                {TONE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTone(opt.value)}
                    className="px-3 py-1.5 rounded-full ds-caption font-medium transition-colors"
                    style={{
                      backgroundColor: tone === opt.value ? "var(--accent-color)" : "var(--surface-sunken)",
                      color: tone === opt.value ? "white" : "var(--text-secondary)",
                    }}
                  >
                    {opt.emoji} {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Context selector */}
            <div>
              <label className="ds-caption font-medium mb-2 block" style={{ color: "var(--text-secondary)" }}>
                What for?
              </label>
              <div className="flex flex-wrap gap-2">
                {CONTEXT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setContext(opt.value)}
                    className="px-3 py-1.5 rounded-full ds-caption font-medium transition-colors"
                    style={{
                      backgroundColor: context === opt.value ? "var(--accent-color)" : "var(--surface-sunken)",
                      color: context === opt.value ? "white" : "var(--text-secondary)",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Context detail */}
            <div>
              <label className="ds-caption font-medium mb-2 block" style={{ color: "var(--text-secondary)" }}>
                Details <span style={{ color: "var(--text-tertiary)" }}>(optional)</span>
              </label>
              <Input
                value={contextDetail}
                onChange={(e) => setContextDetail(e.target.value)}
                placeholder="e.g. their new role at Google, intro to Sarah..."
                style={{ backgroundColor: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}
              />
            </div>

            {/* Generate button */}
            <Button
              onClick={generateDraft}
              disabled={isGenerating}
              className="w-full"
              style={{
                backgroundColor: "var(--accent-color)",
                color: "white",
              }}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Generate draft
                </>
              )}
            </Button>
          </div>
        )}

        {/* Step 3: Draft results */}
        {step === "drafts" && drafts && effectiveContact && (
          <div className="px-5 pb-5 space-y-4">
            {/* M0.x.5: What fed this draft. Audit trail so Jennifer
                can see which references + examples shaped the output. */}
            {drafts.voiceContextUsed && (
              <WhatImUsingDisclosure summary={drafts.voiceContextUsed} />
            )}

            {/* Subject line */}
            {drafts.subjectLine && (
              <div>
                <label className="ds-caption font-medium mb-1 block" style={{ color: "var(--text-tertiary)" }}>
                  Subject
                </label>
                <p className="ds-body-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {drafts.subjectLine}
                </p>
              </div>
            )}

            {/* Toggle quick/detailed */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowDetailed(false)}
                className="px-3 py-1.5 rounded-full ds-caption font-medium transition-colors"
                style={{
                  backgroundColor: !showDetailed ? "var(--accent-color)" : "var(--surface-sunken)",
                  color: !showDetailed ? "white" : "var(--text-secondary)",
                }}
              >
                Quick
              </button>
              <button
                onClick={() => setShowDetailed(true)}
                className="px-3 py-1.5 rounded-full ds-caption font-medium transition-colors"
                style={{
                  backgroundColor: showDetailed ? "var(--accent-color)" : "var(--surface-sunken)",
                  color: showDetailed ? "white" : "var(--text-secondary)",
                }}
              >
                Detailed
              </button>
            </div>

            {/* Draft text */}
            <div
              className="rounded-[var(--radius-md)] p-4 whitespace-pre-wrap ds-body-sm leading-relaxed"
              style={{
                backgroundColor: "var(--surface-sunken)",
                color: "var(--text-primary)",
                minHeight: "80px",
              }}
            >
              {activeDraft}
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              {/* Primary action: push the draft into the user's real Gmail
                  drafts folder with proper threading. Only shows when we
                  have an email on file. */}
              {effectiveContact.email && (
                <Button
                  size="sm"
                  onClick={saveToGmail}
                  disabled={savingToGmail || !draftId}
                  style={{
                    backgroundColor: "var(--accent-color)",
                    color: "var(--text-inverse)",
                  }}
                >
                  {savingToGmail ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : gmailDeepLink ? (
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {gmailDeepLink ? "Saved to Gmail" : "Save to Gmail"}
                </Button>
              )}
              {gmailDeepLink && (
                <a
                  href={gmailDeepLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center text-[12px] font-medium"
                  style={{ color: "var(--accent-color)" }}
                >
                  Open in Gmail →
                </a>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => copyDraft(activeDraft ?? "")}
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => openEmail(activeDraft ?? "", drafts.subjectLine)}
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                <Mail className="mr-1.5 h-3.5 w-3.5" />
                Mailto
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const smsBody = encodeURIComponent(activeDraft ?? "");
                  window.open(`sms:${effectiveContact.phone ?? ""}?body=${smsBody}`);
                }}
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                Text
              </Button>

              {effectiveContact.linkedinUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openLinkedIn}
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                >
                  <Linkedin className="mr-1.5 h-3.5 w-3.5" />
                  LinkedIn
                </Button>
              )}
            </div>

            {/* Regenerate + back */}
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => setStep("configure")}
                className="ds-caption font-medium transition-colors"
                style={{ color: "var(--text-tertiary)" }}
              >
                ← Edit options
              </button>
              <Button
                variant="ghost"
                size="sm"
                onClick={generateDraft}
                disabled={isGenerating}
                style={{ color: "var(--text-secondary)" }}
              >
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isGenerating ? "animate-spin" : ""}`} />
                Regenerate
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * M0.x.4: shows the inbound message the draft will respond to.
 * Loading shimmer → loaded body. Falls back to a "couldn't load"
 * note if the fetch returned null (deleted message / token issue);
 * the draft still generates with snippet-only context in that case.
 */
/**
 * M0.x.5: surfaces what fed the draft — voice references + sent-mail
 * examples + relationship classification. Collapsed by default; the
 * goal is calm provenance, not noise.
 */
function WhatImUsingDisclosure({
  summary,
}: {
  summary: VoiceContextSummary;
}) {
  const [expanded, setExpanded] = useState(false);
  const refCount = summary.references.length;
  const exCount = summary.examples.length;
  if (refCount === 0 && exCount === 0) return null;

  return (
    <div
      className="rounded-[var(--radius-md)] px-3 py-2"
      style={{
        backgroundColor: "var(--surface-sunken)",
        border: "1px solid var(--border-subtle, var(--border))",
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-1.5">
          <Sparkles
            className="h-3 w-3 shrink-0"
            style={{ color: "var(--text-tertiary)" }}
          />
          <span className="ds-caption" style={{ color: "var(--text-secondary)" }}>
            What I&rsquo;m using
          </span>
        </div>
        <span className="ds-caption" style={{ color: "var(--text-tertiary)" }}>
          {refCount > 0 && (
            <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
              {refCount} reference{refCount === 1 ? "" : "s"}
              {exCount > 0 ? " · " : ""}
            </span>
          )}
          {exCount > 0 && (
            <span>
              {exCount} past email{exCount === 1 ? "" : "s"}
            </span>
          )}
          <span className="ml-1.5">{expanded ? "↑" : "↓"}</span>
        </span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-2 text-[12px]">
          {refCount > 0 && (
            <div>
              <p
                className="ds-caption font-medium mb-1"
                style={{ color: "var(--text-tertiary)" }}
              >
                Voice references (primary)
              </p>
              <ul className="space-y-0.5" style={{ color: "var(--text-secondary)" }}>
                {summary.references.map((r) => (
                  <li key={r.id}>· {r.filename}</li>
                ))}
              </ul>
            </div>
          )}
          {exCount > 0 && (
            <div>
              <p
                className="ds-caption font-medium mb-1"
                style={{ color: "var(--text-tertiary)" }}
              >
                Past emails to similar contacts ({summary.relationshipType.replace(/_/g, " ")})
              </p>
              <ul className="space-y-0.5" style={{ color: "var(--text-secondary)" }}>
                {summary.examples.map((e, i) => (
                  <li key={i}>
                    · to {e.toEmail} ·{" "}
                    {new Date(e.sentAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReplyingToPanel({
  preview,
  loading,
  showFullThread,
  onToggleThread,
}: {
  preview: ReplyPreviewData | null;
  loading: boolean;
  showFullThread: boolean;
  onToggleThread: () => void;
}) {
  if (loading) {
    return (
      <div
        className="rounded-[var(--radius-md)] px-3.5 py-3 space-y-1.5"
        style={{
          backgroundColor: "var(--surface-sunken)",
          border: "1px solid var(--border-subtle, var(--border))",
        }}
      >
        <div className="flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" style={{ color: "var(--text-tertiary)" }} />
          <span className="ds-caption" style={{ color: "var(--text-tertiary)" }}>
            Loading the message you&rsquo;re replying to&hellip;
          </span>
        </div>
      </div>
    );
  }
  if (!preview) {
    return (
      <div
        className="rounded-[var(--radius-md)] px-3.5 py-3"
        style={{
          backgroundColor: "var(--surface-sunken)",
          border: "1px solid var(--border-subtle, var(--border))",
        }}
      >
        <p className="ds-caption" style={{ color: "var(--text-tertiary)" }}>
          Couldn&rsquo;t load the original message — the draft will fall back to the inbox snippet.
        </p>
      </div>
    );
  }

  const inbound = preview.latestInbound;
  const sender = inbound.fromName ?? inbound.fromEmail;
  const occurred = new Date(inbound.occurredAt);
  // Older messages in the thread, oldest first; the latest inbound
  // (last entry) is shown in full above so we exclude it here.
  const olderHistory = preview.threadHistory.slice(0, -1);

  return (
    <div
      className="rounded-[var(--radius-md)] px-3.5 py-3 space-y-2"
      style={{
        backgroundColor: "var(--surface-sunken)",
        border: "1px solid var(--border-subtle, var(--border))",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="ds-caption font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-tertiary)" }}
        >
          Replying to
        </span>
        <span className="ds-caption" style={{ color: "var(--text-tertiary)" }}>
          {occurred.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      </div>
      <div>
        <p className="ds-body-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {sender}
        </p>
        {inbound.subject && (
          <p
            className="ds-caption mt-0.5"
            style={{ color: "var(--text-secondary)", letterSpacing: "-0.01em" }}
          >
            {inbound.subject}
          </p>
        )}
      </div>
      <p
        className="ds-body-sm whitespace-pre-wrap"
        style={{
          color: "var(--text-secondary)",
          lineHeight: 1.55,
          maxHeight: showFullThread ? "none" : "260px",
          overflowY: showFullThread ? "visible" : "auto",
        }}
      >
        {inbound.body || "(empty body)"}
      </p>
      {!inbound.bodyIsFull && (
        <p className="ds-caption" style={{ color: "var(--text-tertiary)" }}>
          Snippet only — full message couldn&rsquo;t be fetched from Gmail.
        </p>
      )}
      {olderHistory.length > 0 && (
        <>
          <button
            onClick={onToggleThread}
            className="ds-caption inline-flex items-center gap-1 transition-colors"
            style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-tertiary)";
            }}
          >
            <ChevronDown
              className="h-3 w-3"
              style={{
                transform: showFullThread ? "rotate(180deg)" : "none",
                transition: "transform var(--duration-fast)",
              }}
            />
            {showFullThread
              ? "Hide thread history"
              : `Show ${olderHistory.length} earlier ${olderHistory.length === 1 ? "message" : "messages"}`}
          </button>
          {showFullThread && (
            <div className="space-y-2 pt-1">
              {olderHistory.map((m, i) => (
                <div
                  key={i}
                  className="rounded-[var(--radius-sm)] px-2.5 py-2"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border-subtle, var(--border))",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="ds-caption font-medium"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {m.direction === "OUTBOUND" ? "You" : m.fromName ?? m.fromEmail}
                    </span>
                    <span className="ds-caption" style={{ color: "var(--text-tertiary)" }}>
                      {new Date(m.occurredAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                  {m.snippet && (
                    <p
                      className="ds-caption mt-1"
                      style={{
                        color: "var(--text-tertiary)",
                        lineHeight: 1.4,
                      }}
                    >
                      {m.snippet}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
