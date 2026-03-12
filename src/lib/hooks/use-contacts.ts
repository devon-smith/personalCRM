import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Contact, Interaction } from "@/generated/prisma/client";

export type ContactWithCount = Contact & {
  _count: { interactions: number };
};

export type ContactWithDetails = Contact & {
  interactions: Interaction[];
};

interface ContactFilters {
  search?: string;
  tier?: string;
  source?: string;
  tag?: string;
  sort?: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function useContacts(filters: ContactFilters = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.tier) params.set("tier", filters.tier);
  if (filters.source) params.set("source", filters.source);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.sort) params.set("sort", filters.sort);

  const queryString = params.toString();
  const url = `/api/contacts${queryString ? `?${queryString}` : ""}`;

  return useQuery<ContactWithCount[]>({
    queryKey: ["contacts", filters],
    queryFn: () => fetchJson(url),
  });
}

export function useContact(id: string | null) {
  return useQuery<ContactWithDetails>({
    queryKey: ["contact", id],
    queryFn: () => fetchJson(`/api/contacts/${id}`),
    enabled: !!id,
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Contact>) =>
      fetchJson<Contact>("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Contact> & { id: string }) =>
      fetchJson<Contact>(`/api/contacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["contact", variables.id] });
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/contacts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
