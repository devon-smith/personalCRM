"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Loader2, Mail, Check } from "lucide-react";
import { toast } from "sonner";
import { buildMailtoLink } from "@/lib/email-templates";

interface FollowUpDraftModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  contactEmail?: string | null;
}

export function FollowUpDraftModal({
  open,
  onOpenChange,
  contactId,
  contactName,
  contactEmail,
}: FollowUpDraftModalProps) {
  const [drafts, setDrafts] = useState<{
    casual: string;
    professional: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedTab, setCopiedTab] = useState<string | null>(null);

  async function generateDrafts() {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      if (!res.ok) throw new Error("Failed to generate drafts");
      const data = await res.json();
      setDrafts(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to generate drafts"
      );
    } finally {
      setLoading(false);
    }
  }

  function handleCopy(text: string, tab: string) {
    navigator.clipboard.writeText(text);
    setCopiedTab(tab);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedTab(null), 2000);
  }

  // Auto-generate on open
  if (open && !drafts && !loading) {
    generateDrafts();
  }

  function handleClose(openState: boolean) {
    if (!openState) {
      setDrafts(null);
      setLoading(false);
      setCopiedTab(null);
    }
    onOpenChange(openState);
  }

  function renderDraftActions(text: string, tabKey: string) {
    const isCopied = copiedTab === tabKey;

    return (
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleCopy(text, tabKey)}
        >
          {isCopied ? (
            <Check className="mr-1.5 h-3 w-3 text-green-500" />
          ) : (
            <Copy className="mr-1.5 h-3 w-3" />
          )}
          {isCopied ? "Copied!" : "Copy"}
        </Button>
        {contactEmail && (
          <a
            href={buildMailtoLink(
              contactEmail,
              `Following up — ${contactName}`,
              text
            )}
          >
            <Button variant="outline" size="sm" type="button">
              <Mail className="mr-1.5 h-3 w-3" />
              Open in Email
            </Button>
          </a>
        )}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Follow-Up Draft for {contactName}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
            <span className="ml-2 text-sm text-gray-500">
              Generating drafts...
            </span>
          </div>
        ) : drafts ? (
          <Tabs defaultValue="casual">
            <TabsList>
              <TabsTrigger value="casual">Casual</TabsTrigger>
              <TabsTrigger value="professional">Professional</TabsTrigger>
            </TabsList>
            <TabsContent value="casual" className="space-y-3">
              <div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-sm text-gray-800">
                {drafts.casual}
              </div>
              {renderDraftActions(drafts.casual, "casual")}
            </TabsContent>
            <TabsContent value="professional" className="space-y-3">
              <div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-sm text-gray-800">
                {drafts.professional}
              </div>
              {renderDraftActions(drafts.professional, "professional")}
            </TabsContent>
          </Tabs>
        ) : null}

        <div className="flex justify-end gap-2">
          {drafts && (
            <Button
              variant="outline"
              size="sm"
              onClick={generateDrafts}
              disabled={loading}
            >
              Regenerate
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
