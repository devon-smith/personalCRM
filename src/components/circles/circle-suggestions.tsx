"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import {
  Sparkles,
  Plus,
  UserPlus,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { toast } from "sonner";
import type { CircleSuggestion } from "@/app/api/circles/suggestions/route";

const reasonLabels: Record<string, string> = {
  education: "Education",
  work: "Work",
  frequent_interaction: "Friends",
};

interface SuggestionsResponse {
  suggestions: CircleSuggestion[];
}

export function CircleSuggestions() {
  const queryClient = useQueryClient();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Track removed contacts per suggestion: suggestionId -> Set of removed contactIds
  const [removedContacts, setRemovedContacts] = useState<
    Record<string, Set<string>>
  >({});

  const { data, isLoading } = useQuery<SuggestionsResponse>({
    queryKey: ["circle-suggestions"],
    queryFn: async () => {
      const res = await fetch("/api/circles/suggestions");
      if (!res.ok) throw new Error("Failed to fetch suggestions");
      return res.json();
    },
  });

  const removeContact = useCallback(
    (suggestionId: string, contactId: string) => {
      setRemovedContacts((prev) => {
        const existing = prev[suggestionId] ?? new Set();
        return {
          ...prev,
          [suggestionId]: new Set([...existing, contactId]),
        };
      });
    },
    [],
  );

  const getActiveContacts = useCallback(
    (suggestion: CircleSuggestion) => {
      const removed = removedContacts[suggestion.id];
      if (!removed || removed.size === 0) return suggestion.contacts;
      return suggestion.contacts.filter((c) => !removed.has(c.id));
    },
    [removedContacts],
  );

  const getActiveContactIds = useCallback(
    (suggestion: CircleSuggestion) => {
      const removed = removedContacts[suggestion.id];
      if (!removed || removed.size === 0) return suggestion.contactIds;
      return suggestion.contactIds.filter((id) => !removed.has(id));
    },
    [removedContacts],
  );

  const createAndAssign = useMutation({
    mutationFn: async ({
      suggestion,
      contactIds,
    }: {
      suggestion: CircleSuggestion;
      contactIds: readonly string[];
    }) => {
      const createRes = await fetch("/api/circles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: suggestion.name,
          color: suggestColor(suggestion.reason),
          followUpDays: suggestion.suggestedCadence,
        }),
      });
      if (!createRes.ok) throw new Error("Failed to create circle");
      const circle = await createRes.json();
      await assignContacts(circle.id, contactIds);
      return { circleName: suggestion.name, count: contactIds.length };
    },
    onSuccess: ({ circleName, count }) => {
      toast.success(`Created "${circleName}" with ${count} contacts`);
      queryClient.invalidateQueries({ queryKey: ["circles"] });
      queryClient.invalidateQueries({ queryKey: ["circle-suggestions"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const addToExisting = useMutation({
    mutationFn: async ({
      circleId,
      contactIds,
      circleName,
    }: {
      circleId: string;
      contactIds: readonly string[];
      circleName: string;
    }) => {
      await assignContacts(circleId, contactIds);
      return { circleName, count: contactIds.length };
    },
    onSuccess: ({ circleName, count }) => {
      toast.success(`Added ${count} contacts to "${circleName}"`);
      queryClient.invalidateQueries({ queryKey: ["circles"] });
      queryClient.invalidateQueries({ queryKey: ["circle-suggestions"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const suggestions = (data?.suggestions ?? []).filter(
    (s) => !dismissedIds.has(s.id),
  );

  if (isLoading || suggestions.length === 0) return null;

  const isPending = createAndAssign.isPending || addToExisting.isPending;

  return (
    <div className="crm-animate-enter mt-6">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-500" />
        <h2 className="text-[14px] font-semibold text-[#1A1A1A]">
          Suggested circles
        </h2>
        <span className="text-[12px] text-[#AAAFB5]">
          Based on your contacts and interaction patterns
        </span>
      </div>

      <div className="space-y-2">
        {suggestions.map((suggestion) => {
          const isExpanded = expandedId === suggestion.id;
          const activeContacts = getActiveContacts(suggestion);
          const activeIds = getActiveContactIds(suggestion);

          // If all contacts removed, treat as dismissed
          if (activeContacts.length === 0) return null;

          return (
            <div
              key={suggestion.id}
              className="rounded-xl border border-gray-100 bg-white transition-colors"
            >
              {/* Main row — clickable to expand */}
              <button
                type="button"
                className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-gray-50/50 transition-colors rounded-xl"
                onClick={() =>
                  setExpandedId(isExpanded ? null : suggestion.id)
                }
              >
                {/* Circle icon */}
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold text-white"
                  style={{
                    backgroundColor: suggestColor(suggestion.reason),
                  }}
                >
                  {suggestion.name.charAt(0).toUpperCase()}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-gray-900 truncate">
                      {suggestion.name}
                    </span>
                    <span className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                      {reasonLabels[suggestion.reason] ?? suggestion.reason}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-gray-500">
                    {activeContacts.length} contacts
                  </p>
                </div>

                {/* Preview avatars (collapsed only) */}
                {!isExpanded && (
                  <div className="flex items-center gap-1 shrink-0">
                    {activeContacts.slice(0, 4).map((contact) => {
                      const color = getAvatarColor(contact.name);
                      return (
                        <Avatar key={contact.id} className="h-5 w-5">
                          <AvatarFallback
                            className="text-[8px] font-semibold"
                            style={{
                              backgroundColor: color.bg,
                              color: color.text,
                            }}
                          >
                            {getInitials(contact.name)}
                          </AvatarFallback>
                        </Avatar>
                      );
                    })}
                    {activeContacts.length > 4 && (
                      <span className="text-[10px] text-gray-400 ml-0.5">
                        +{activeContacts.length - 4}
                      </span>
                    )}
                  </div>
                )}

                {/* Expand/collapse icon */}
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-gray-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
                )}
              </button>

              {/* Expanded contact list */}
              {isExpanded && (
                <div className="border-t border-gray-100">
                  <div className="max-h-[280px] overflow-y-auto px-4 py-2">
                    {activeContacts.map((contact) => {
                      const color = getAvatarColor(contact.name);
                      return (
                        <div
                          key={contact.id}
                          className="flex items-center gap-3 py-1.5 group"
                        >
                          <Avatar className="h-6 w-6 shrink-0">
                            <AvatarFallback
                              className="text-[9px] font-semibold"
                              style={{
                                backgroundColor: color.bg,
                                color: color.text,
                              }}
                            >
                              {getInitials(contact.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-[13px] text-gray-900 truncate flex-1">
                            {contact.name}
                          </span>
                          {contact.company && (
                            <span className="text-[11px] text-gray-400 truncate shrink-0 max-w-[120px]">
                              {contact.company}
                            </span>
                          )}
                          <button
                            type="button"
                            className="shrink-0 rounded-md p-1 text-gray-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeContact(suggestion.id, contact.id);
                            }}
                            title={`Remove ${contact.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-3">
                    {suggestion.existingCircle ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 text-[11px] rounded-lg"
                        disabled={isPending || activeIds.length === 0}
                        onClick={() =>
                          addToExisting.mutate({
                            circleId: suggestion.existingCircle!.id,
                            contactIds: activeIds,
                            circleName: suggestion.existingCircle!.name,
                          })
                        }
                      >
                        {addToExisting.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <UserPlus className="h-3 w-3" />
                        )}
                        Add {activeIds.length} to{" "}
                        {suggestion.existingCircle.name}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="h-7 gap-1.5 text-[11px] rounded-lg"
                        disabled={isPending || activeIds.length === 0}
                        onClick={() =>
                          createAndAssign.mutate({
                            suggestion,
                            contactIds: activeIds,
                          })
                        }
                      >
                        {createAndAssign.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Plus className="h-3 w-3" />
                        )}
                        Create circle with {activeIds.length}
                      </Button>
                    )}
                    <button
                      className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors ml-auto"
                      onClick={() =>
                        setDismissedIds(
                          (prev) => new Set([...prev, suggestion.id]),
                        )
                      }
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Helpers ──

async function assignContacts(
  circleId: string,
  contactIds: readonly string[],
) {
  const res = await fetch(`/api/circles/${circleId}/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactIds }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Failed to assign contacts");
  }
}

function suggestColor(reason: string): string {
  const colors: Record<string, string> = {
    education: "#8B5CF6",
    work: "#3B82F6",
    frequent_interaction: "#10B981",
  };
  return colors[reason] ?? "#6B7280";
}
