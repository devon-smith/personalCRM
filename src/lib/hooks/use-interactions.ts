"use client";

import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { Interaction } from "@/generated/prisma/client";
import type {
  ContactWithCount,
  ContactWithDetails,
} from "@/lib/hooks/use-contacts";

interface LogInteractionInput {
  contactId: string;
  type: string;
  direction: string;
  subject?: string;
  summary?: string;
  occurredAt?: string;
  channel?: string;
}

export function useLogInteraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: LogInteractionInput) => {
      const res = await fetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to log interaction");
      }
      return res.json() as Promise<Interaction>;
    },
    onSuccess: (interaction) => {
      patchLoggedInteractionCaches(queryClient, interaction);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function patchLoggedInteractionCaches(
  queryClient: QueryClient,
  interaction: Interaction,
) {
  queryClient.setQueryData<ContactWithDetails>(
    ["contact", interaction.contactId],
    (current) => current
      ? {
          ...current,
          lastInteraction: interaction.occurredAt,
          interactions: [
            interaction,
            ...current.interactions.filter((item) => item.id !== interaction.id),
          ].slice(0, 50),
        }
      : current,
  );

  queryClient.setQueryData<ContactWithCount>(
    ["contact-summary", interaction.contactId],
    (current) => current
      ? patchContactListItem(current, interaction)
      : current,
  );

  for (const [queryKey, contacts] of queryClient.getQueriesData<ContactWithCount[]>({
    queryKey: ["contacts"],
  })) {
    if (!contacts?.some((contact) => contact.id === interaction.contactId)) {
      continue;
    }
    const patched = contacts.map((contact) =>
      contact.id === interaction.contactId
        ? patchContactListItem(contact, interaction)
        : contact,
    );
    queryClient.setQueryData(
      queryKey,
      getContactsSort(queryKey) === "lastInteraction"
        ? sortByLastInteraction(patched)
        : patched,
    );
  }
}

function patchContactListItem(
  contact: ContactWithCount,
  interaction: Interaction,
): ContactWithCount {
  return {
    ...contact,
    lastInteraction: interaction.occurredAt,
    _count: {
      ...contact._count,
      interactions: contact._count.interactions + 1,
    },
  };
}

function getContactsSort(queryKey: QueryKey): string | null {
  const filters = Array.isArray(queryKey) ? queryKey[1] : null;
  return filters &&
    typeof filters === "object" &&
    !Array.isArray(filters) &&
    "sort" in filters &&
    typeof filters.sort === "string"
    ? filters.sort
    : null;
}

function sortByLastInteraction(contacts: ContactWithCount[]) {
  return [...contacts].sort((a, b) => {
    const bTime = getDateTime(b.lastInteraction);
    const aTime = getDateTime(a.lastInteraction);
    return bTime - aTime || a.name.localeCompare(b.name);
  });
}

function getDateTime(value: Date | string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}
