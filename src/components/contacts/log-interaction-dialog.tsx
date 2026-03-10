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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLogInteraction } from "@/lib/hooks/use-reminders";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";

const interactionTypes = [
  { value: "NOTE", label: "Note" },
  { value: "CALL", label: "Call" },
  { value: "MEETING", label: "Meeting" },
  { value: "EMAIL", label: "Email" },
  { value: "MESSAGE", label: "Message" },
];

interface LogInteractionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
}

export function LogInteractionDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
}: LogInteractionDialogProps) {
  const [type, setType] = useState("NOTE");
  const [direction, setDirection] = useState("OUTBOUND");
  const [subject, setSubject] = useState("");
  const [summary, setSummary] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const logInteraction = useLogInteraction();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    logInteraction.mutate(
      {
        contactId,
        type,
        direction,
        subject: subject || undefined,
        summary: summary || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Interaction logged");
          onOpenChange(false);
          resetForm();
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  async function handleParse() {
    if (!pasteText.trim()) return;
    setParsing(true);
    try {
      const res = await fetch("/api/ai/parse-interaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText, contactId }),
      });
      if (!res.ok) throw new Error("Failed to parse");
      const data = await res.json();
      setType(data.type);
      setDirection(data.direction);
      setSubject(data.subject);
      setSummary(data.summary);
      toast.success("Parsed! Review the fields below and save.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to parse text"
      );
    } finally {
      setParsing(false);
    }
  }

  function resetForm() {
    setType("NOTE");
    setDirection("OUTBOUND");
    setSubject("");
    setSummary("");
    setPasteText("");
    setParsing(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log Interaction with {contactName}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="manual">
          <TabsList className="mb-3">
            <TabsTrigger value="manual">Manual</TabsTrigger>
            <TabsTrigger value="paste">
              <Sparkles className="mr-1 h-3 w-3" />
              Paste & Parse
            </TabsTrigger>
          </TabsList>

          <TabsContent value="paste">
            <div className="space-y-3">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste an email, message, or notes here..."
                rows={5}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
              />
              <Button
                type="button"
                onClick={handleParse}
                disabled={!pasteText.trim() || parsing}
                className="w-full"
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
          </TabsContent>

          <TabsContent value="manual">
            <span />
          </TabsContent>
        </Tabs>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
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
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
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
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Quick catch-up call"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Summary
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What was discussed..."
              rows={3}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={logInteraction.isPending}>
              {logInteraction.isPending ? "Saving..." : "Log Interaction"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
