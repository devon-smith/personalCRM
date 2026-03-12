"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
import { useContacts, type ContactWithCount } from "@/lib/hooks/use-contacts";
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
} from "lucide-react";
import { toast } from "sonner";

interface DraftResult {
  readonly quick: string;
  readonly detailed: string;
  readonly subjectLine: string | null;
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
  const { isOpen, contactId: presetContactId, presetTone, presetContext, threadSubject, threadSnippet, closeComposer } =
    useDraftComposer();

  const [step, setStep] = useState<ComposerStep>("pick_contact");
  const [selectedContact, setSelectedContact] = useState<ContactWithCount | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 200);
  const { data: contacts } = useContacts({ search: debouncedSearch });

  const [tone, setTone] = useState<DraftTone>("warm");
  const [context, setContext] = useState<DraftContext>("catching_up");
  const [contextDetail, setContextDetail] = useState("");

  const [drafts, setDrafts] = useState<DraftResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showDetailed, setShowDetailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setDrafts(null);
      setIsGenerating(false);
      setShowDetailed(false);
      setCopied(false);
      setContextDetail("");
      setSearch("");

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

  // Resolve preset contact
  const { data: allContacts } = useContacts({});
  useEffect(() => {
    if (presetContactId && allContacts && !selectedContact) {
      const found = allContacts.find((c) => c.id === presetContactId);
      if (found) setSelectedContact(found);
    }
  }, [presetContactId, allContacts, selectedContact]);

  // Focus search on contact picker step
  useEffect(() => {
    if (step === "pick_contact" && isOpen) {
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [step, isOpen]);

  const selectContact = useCallback((contact: ContactWithCount) => {
    setSelectedContact(contact);
    setStep("configure");
    setSearch("");
  }, []);

  const generateDraft = useCallback(async () => {
    if (!selectedContact) return;

    setIsGenerating(true);
    setDrafts(null);
    try {
      const res = await fetch("/api/drafts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: selectedContact.id,
          tone,
          context,
          contextDetail: contextDetail || undefined,
          threadSubject: threadSubject || undefined,
          threadSnippet: threadSnippet || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Generation failed");
      }

      const result: DraftResult = await res.json();
      setDrafts(result);
      setStep("drafts");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate draft");
    } finally {
      setIsGenerating(false);
    }
  }, [selectedContact, tone, context, contextDetail, threadSubject, threadSnippet]);

  const copyDraft = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const openEmail = useCallback((text: string, subject: string | null) => {
    if (!selectedContact?.email) {
      toast.error("No email on file for this contact");
      return;
    }
    const params = new URLSearchParams();
    if (subject) params.set("subject", subject);
    params.set("body", text);
    window.open(`mailto:${selectedContact.email}?${params.toString()}`);
  }, [selectedContact]);

  const openLinkedIn = useCallback(() => {
    if (!selectedContact?.linkedinUrl) {
      toast.error("No LinkedIn URL on file");
      return;
    }
    window.open(selectedContact.linkedinUrl, "_blank");
  }, [selectedContact]);

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
            {step === "configure" && selectedContact && `Message ${selectedContact.name.split(" ")[0]}`}
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
        {step === "configure" && selectedContact && (
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
                  {getInitials(selectedContact.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="ds-body-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {selectedContact.name}
                </p>
                <p className="ds-caption" style={{ color: "var(--text-tertiary)" }}>
                  {[selectedContact.role, selectedContact.company].filter(Boolean).join(" at ") || selectedContact.email || "No details"}
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
        {step === "drafts" && drafts && selectedContact && (
          <div className="px-5 pb-5 space-y-4">
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
                Email
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const smsBody = encodeURIComponent(activeDraft ?? "");
                  window.open(`sms:${selectedContact.phone ?? ""}?body=${smsBody}`);
                }}
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                Text
              </Button>

              {selectedContact.linkedinUrl && (
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
