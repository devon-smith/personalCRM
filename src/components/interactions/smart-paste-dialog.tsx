"use client";

import { useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Check } from "lucide-react";
import { useLogInteraction } from "@/lib/hooks/use-reminders";
import { toast } from "sonner";

const interactionTypes = [
  { value: "NOTE", label: "Note" },
  { value: "CALL", label: "Call" },
  { value: "MEETING", label: "Meeting" },
  { value: "EMAIL", label: "Email" },
  { value: "MESSAGE", label: "Message" },
];

interface SmartPasteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
}

interface ParsedFields {
  type: string;
  direction: string;
  subject: string;
  summary: string;
  occurredAt: string | null;
}

export function SmartPasteDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
}: SmartPasteDialogProps) {
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<ParsedFields | null>(null);
  const [parsing, setParsing] = useState(false);
  const [step, setStep] = useState<"paste" | "review">("paste");
  const logInteraction = useLogInteraction();

  async function handleParse() {
    if (!rawText.trim()) return;
    setParsing(true);
    try {
      const res = await fetch("/api/ai/parse-interaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawText, contactId }),
      });
      if (!res.ok) throw new Error("Failed to parse");
      const data = await res.json();
      setParsed(data);
      setStep("review");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to parse text"
      );
    } finally {
      setParsing(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!parsed) return;

    logInteraction.mutate(
      {
        contactId,
        type: parsed.type,
        direction: parsed.direction,
        subject: parsed.subject || undefined,
        summary: parsed.summary || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Interaction logged");
          handleClose();
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  function handleClose() {
    setRawText("");
    setParsed(null);
    setStep("paste");
    setParsing(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : handleClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            Smart Log — {contactName}
          </DialogTitle>
        </DialogHeader>

        {step === "paste" && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Paste an email, message, or meeting notes
              </label>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={"Paste text here...\n\nExamples:\n- An email thread\n- Slack/text messages\n- Meeting notes\n- Any interaction text"}
                rows={8}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleParse}
                disabled={!rawText.trim() || parsing}
              >
                {parsing ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Parsing...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 h-4 w-4" />
                    Parse with AI
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {step === "review" && parsed && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-md bg-purple-50 px-3 py-2 text-xs text-purple-700">
              AI-parsed fields — edit anything before saving
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Type
                </label>
                <select
                  value={parsed.type}
                  onChange={(e) =>
                    setParsed({ ...parsed, type: e.target.value })
                  }
                  className="h-8 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                >
                  {interactionTypes.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Direction
                </label>
                <select
                  value={parsed.direction}
                  onChange={(e) =>
                    setParsed({ ...parsed, direction: e.target.value })
                  }
                  className="h-8 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                >
                  <option value="OUTBOUND">Outbound</option>
                  <option value="INBOUND">Inbound</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Subject
              </label>
              <Input
                value={parsed.subject}
                onChange={(e) =>
                  setParsed({ ...parsed, subject: e.target.value })
                }
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Summary
              </label>
              <textarea
                value={parsed.summary}
                onChange={(e) =>
                  setParsed({ ...parsed, summary: e.target.value })
                }
                rows={3}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep("paste")}
              >
                Back to paste
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={logInteraction.isPending}>
                  {logInteraction.isPending ? (
                    "Saving..."
                  ) : (
                    <>
                      <Check className="mr-1.5 h-4 w-4" />
                      Save Interaction
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
