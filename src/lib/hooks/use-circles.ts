import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { WarmthLevel } from "@/components/ui/warmth-avatar";

export interface CircleContact {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  avatarUrl: string | null;
  warmth: WarmthLevel;
  daysSince: number | null;
}

export interface CircleWithContacts {
  id: string;
  name: string;
  color: string;
  icon: string;
  followUpDays: number;
  sortOrder: number;
  isDefault: boolean;
  contacts: CircleContact[];
  health: { good: number; mid: number; cold: number };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function useCircles() {
  return useQuery<CircleWithContacts[]>({
    queryKey: ["circles"],
    queryFn: () => fetchJson("/api/circles"),
    staleTime: 60_000,
  });
}

export function useCreateCircle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      color?: string;
      icon?: string;
      followUpDays?: number;
    }) =>
      fetchJson("/api/circles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["circles"] });
    },
  });
}

export function useUpdateCircle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      color?: string;
      icon?: string;
      followUpDays?: number;
    }) =>
      fetchJson(`/api/circles/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["circles"] });
    },
  });
}

export function useDeleteCircle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/circles/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["circles"] });
    },
  });
}

export function useAddContactsToCircle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ circleId, contactIds }: { circleId: string; contactIds: string[] }) =>
      fetchJson(`/api/circles/${circleId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["circles"] });
    },
  });
}

export function useRemoveContactsFromCircle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ circleId, contactIds }: { circleId: string; contactIds: string[] }) =>
      fetchJson(`/api/circles/${circleId}/contacts`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["circles"] });
    },
  });
}
