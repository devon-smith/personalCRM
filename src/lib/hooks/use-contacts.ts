import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { Contact, Interaction } from "@/generated/prisma/client";
import type { ContactListItem } from "@/lib/contact-list-query";

export type ContactWithCount = ContactListItem;

export type ContactWithDetails = Contact & {
  interactions: Interaction[];
  circles: { circle: { id: string; name: string; color: string } }[];
};

const CONTACT_LIST_INVALIDATING_FIELDS = new Set<keyof Contact>([
  "name",
  "email",
  "additionalEmails",
  "company",
  "tier",
  "source",
  "tags",
]);

interface ContactFilters {
  search?: string;
  tier?: string;
  circle?: string;
  source?: string;
  tag?: string;
  sort?: string;
  limit?: number;
}

interface ContactQueryOptions {
  enabled?: boolean;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function useContacts(
  filters: ContactFilters = {},
  options: ContactQueryOptions = {},
) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.tier) params.set("tier", filters.tier);
  if (filters.circle) params.set("circle", filters.circle);
  if (filters.source) params.set("source", filters.source);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.limit) params.set("limit", String(filters.limit));

  const queryString = params.toString();
  const url = `/api/contacts${queryString ? `?${queryString}` : ""}`;

  return useQuery<ContactWithCount[]>({
    queryKey: ["contacts", filters],
    queryFn: () => fetchJson(url),
    enabled: options.enabled ?? true,
    staleTime: 5 * 60_000,
  });
}

export function useContact(id: string | null) {
  return useQuery<ContactWithDetails>({
    queryKey: ["contact", id],
    queryFn: () => fetchJson(`/api/contacts/${id}`),
    enabled: !!id,
  });
}

export function useContactSummary(id: string | null) {
  return useQuery<ContactWithCount>({
    queryKey: ["contact-summary", id],
    queryFn: () => fetchJson(`/api/contacts/${id}?scope=summary`),
    enabled: !!id,
    staleTime: 5 * 60_000,
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
    onSuccess: (contact, variables) => {
      queryClient.setQueryData<ContactWithDetails>(
        ["contact", variables.id],
        (current) => current ? { ...current, ...contact } : current,
      );
      queryClient.setQueryData<ContactWithCount>(
        ["contact-summary", variables.id],
        (current) => current ? { ...current, ...contact } : current,
      );
      patchContactListCaches(queryClient, contact);
      if (shouldInvalidateContactListCaches(variables)) {
        queryClient.invalidateQueries({ queryKey: ["contacts"] });
      }
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/contacts/${id}`, { method: "DELETE" }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.removeQueries({ queryKey: ["contact", id], exact: true });
      queryClient.removeQueries({ queryKey: ["contact-summary", id], exact: true });
    },
  });
}

export function patchContactListCaches(
  queryClient: QueryClient,
  contact: Partial<Contact> & { id: string },
) {
  queryClient.setQueriesData<ContactWithCount[]>(
    { queryKey: ["contacts"] },
    (current) => current
      ? current.map((item) =>
          item.id === contact.id ? { ...item, ...contact } : item,
        )
      : current,
  );
}

export function shouldInvalidateContactListCaches(
  update: Partial<Contact> & { id: string },
) {
  return Object.keys(update).some((key) =>
    key !== "id" &&
    CONTACT_LIST_INVALIDATING_FIELDS.has(key as keyof Contact),
  );
}
