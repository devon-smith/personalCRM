"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Link2, Phone, Mail, Search, Check, X } from "lucide-react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────

interface HandleSuggestion {
  contactId: string;
  contactName: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  reason: string;
  confidence: number;
}

interface LinkHandleDialogProps {
  handle: string;
  messageCount?: number;
  service?: string;
  onClose: () => void;
  onLinked?: (contactId: string) => void;
}

// ─── Component ──────────────────────────────────────────────

export function LinkHandleDialog({
  handle,
  messageCount,
  service,
  onClose,
  onLinked,
}: LinkHandleDialogProps) {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const isEmail = handle.includes("@");

  // Fetch suggestions
  const { data, isLoading } = useQuery<{
    handle: string;
    suggestions: HandleSuggestion[];
  }>({
    queryKey: ["link-handle-suggestions", handle],
    queryFn: async () => {
      const res = await fetch(
        `/api/contacts/link-handle?handle=${encodeURIComponent(handle)}`,
      );
      if (!res.ok) throw new Error("Failed to fetch suggestions");
      return res.json();
    },
  });

  // Search contacts
  const { data: searchResults } = useQuery<
    Array<{ id: string; name: string; company: string | null; email: string | null; phone: string | null }>
  >({
    queryKey: ["contacts-search", searchTerm],
    queryFn: async () => {
      const res = await fetch(
        `/api/contacts?search=${encodeURIComponent(searchTerm)}&limit=5`,
      );
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: searchTerm.length >= 2,
  });

  // Link mutation
  const linkMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const res = await fetch("/api/contacts/link-handle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, contactId }),
      });
      if (!res.ok) throw new Error("Failed to link");
      return res.json();
    },
    onSuccess: (_, contactId) => {
      toast.success("Handle linked to contact");
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["needs-response"] });
      onLinked?.(contactId);
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const suggestions = data?.suggestions ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div
        className="mx-4 w-full max-w-md rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-3">
          <div>
            <h3
              className="text-[16px] font-semibold text-[#1A1A1A]"
              style={{ letterSpacing: "-0.02em" }}
            >
              Link to contact
            </h3>
            <div className="mt-1 flex items-center gap-2 text-[13px] text-[#7B8189]">
              {isEmail ? (
                <Mail className="h-3.5 w-3.5 text-[#B5BAC0]" />
              ) : (
                <Phone className="h-3.5 w-3.5 text-[#B5BAC0]" />
              )}
              <span className="font-medium text-[#4A4E54]">{handle}</span>
              {messageCount && (
                <span className="text-[#B5BAC0]">
                  &middot; {messageCount} messages
                </span>
              )}
              {service && (
                <span className="text-[#B5BAC0]">&middot; {service}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[#B5BAC0] hover:bg-[#F3F4F6] hover:text-[#4A4E54] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#B5BAC0]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search contacts by name..."
              className="w-full rounded-xl border border-[#E8EAED] bg-[#F7F7F8] py-2 pl-9 pr-3 text-[13px] outline-none focus:border-[#B5BAC0] focus:bg-white transition-colors"
            />
          </div>
        </div>

        {/* Suggestions / Search Results */}
        <div className="max-h-[320px] overflow-y-auto px-5 pb-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-[13px] text-[#B5BAC0]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Finding matches...
            </div>
          ) : (
            <>
              {/* Search results (when searching) */}
              {searchTerm.length >= 2 && searchResults && searchResults.length > 0 && (
                <div className="mb-3">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[#B5BAC0]">
                    Search results
                  </p>
                  <div className="space-y-1">
                    {searchResults.map((contact) => (
                      <ContactRow
                        key={contact.id}
                        name={contact.name}
                        detail={contact.company ?? contact.email ?? contact.phone}
                        reason="Manual search"
                        isLinking={
                          linkMutation.isPending &&
                          linkMutation.variables === contact.id
                        }
                        onLink={() => linkMutation.mutate(contact.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* AI suggestions */}
              {suggestions.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[#B5BAC0]">
                    Suggested matches
                  </p>
                  <div className="space-y-1">
                    {suggestions.map((s) => (
                      <ContactRow
                        key={s.contactId}
                        name={s.contactName}
                        detail={s.company ?? s.email ?? s.phone}
                        reason={s.reason}
                        confidence={s.confidence}
                        isLinking={
                          linkMutation.isPending &&
                          linkMutation.variables === s.contactId
                        }
                        onLink={() => linkMutation.mutate(s.contactId)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {suggestions.length === 0 &&
                (!searchResults || searchResults.length === 0) && (
                  <p className="py-8 text-center text-[13px] text-[#B5BAC0]">
                    No matching contacts found. Try searching by name above.
                  </p>
                )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Contact row ─────────────────────────────────────────────

function ContactRow({
  name,
  detail,
  reason,
  confidence,
  isLinking,
  onLink,
}: {
  name: string;
  detail: string | null;
  reason: string;
  confidence?: number;
  isLinking: boolean;
  onLink: () => void;
}) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[#F7F7F8]">
      <div
        className="flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
        style={{
          width: 32,
          height: 32,
          backgroundColor: "#F3F4F6",
          color: "#7B8189",
        }}
      >
        {initials}
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[#1A1A1A]">{name}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-[#9BA1A8]">
          {detail && <span className="truncate">{detail}</span>}
          {detail && <span>&middot;</span>}
          <span className="truncate">{reason}</span>
        </div>
      </div>

      {confidence !== undefined && (
        <span
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            color: confidence >= 0.5 ? "#4A8C5E" : "#C4962E",
            backgroundColor: confidence >= 0.5 ? "#EBF5EE" : "#FBF5E8",
          }}
        >
          {Math.round(confidence * 100)}%
        </span>
      )}

      <button
        onClick={onLink}
        disabled={isLinking}
        className="shrink-0 rounded-lg bg-[#1A1A1A] px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-[#2D2D2D] disabled:opacity-50"
      >
        {isLinking ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Link2 className="h-3 w-3" />
        )}
      </button>
    </div>
  );
}
