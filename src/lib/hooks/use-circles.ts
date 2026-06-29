import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
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
  /** Google contact-group sync state (Milestone 3.2). */
  googleSyncEnabled?: boolean;
  googleSyncedAt?: string | null;
  googleSyncError?: string | null;
}

export type CircleSummary = Omit<CircleWithContacts, "contacts" | "health">;

type CircleMetadataPatch = Partial<CircleSummary> & { id: string };

interface PeopleBootstrapCircleCache {
  contacts?: unknown[];
  circles: { id: string; name: string; color: string }[];
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

function invalidateCircleCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["circles"] });
  queryClient.invalidateQueries({ queryKey: ["contacts", "people-bootstrap"] });
}

function sortCircles<T extends { sortOrder?: number; name: string }>(circles: T[]) {
  return [...circles].sort((a, b) => {
    const sortDelta = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    return sortDelta !== 0 ? sortDelta : a.name.localeCompare(b.name);
  });
}

export function patchCircleMetadataCaches(
  queryClient: QueryClient,
  circle: CircleMetadataPatch,
) {
  queryClient.setQueriesData<CircleWithContacts[]>(
    { queryKey: ["circles"], exact: true },
    (current) => current
      ? sortCircles(
          current.map((item) =>
            item.id === circle.id ? { ...item, ...circle } : item,
          ),
        )
      : current,
  );

  queryClient.setQueriesData<CircleSummary[]>(
    { queryKey: ["circles", "summary"], exact: true },
    (current) => current
      ? sortCircles(
          current.map((item) =>
            item.id === circle.id ? { ...item, ...circle } : item,
          ),
        )
      : current,
  );

  queryClient.setQueriesData<PeopleBootstrapCircleCache>(
    { queryKey: ["contacts", "people-bootstrap"] },
    (current) => {
      if (!current?.circles) return current;
      return {
        ...current,
        circles: current.circles.map((item) =>
          item.id === circle.id
            ? {
                ...item,
                name: circle.name ?? item.name,
                color: circle.color ?? item.color,
              }
            : item,
        ),
      };
    },
  );
}

export function removeCircleFromCaches(
  queryClient: QueryClient,
  circleId: string,
) {
  queryClient.setQueriesData<CircleWithContacts[]>(
    { queryKey: ["circles"], exact: true },
    (current) => current
      ? current.filter((circle) => circle.id !== circleId)
      : current,
  );

  queryClient.setQueriesData<CircleSummary[]>(
    { queryKey: ["circles", "summary"], exact: true },
    (current) => current
      ? current.filter((circle) => circle.id !== circleId)
      : current,
  );

  const peopleBootstrapQueries = queryClient
    .getQueryCache()
    .findAll({ queryKey: ["contacts", "people-bootstrap"] });

  for (const query of peopleBootstrapQueries) {
    const filters = query.queryKey[2] as { circle?: string } | undefined;
    queryClient.setQueryData<PeopleBootstrapCircleCache>(
      query.queryKey,
      (current) => {
        if (!current?.circles) return current;
        return {
          ...current,
          contacts: filters?.circle === circleId ? [] : current.contacts,
          circles: current.circles.filter((circle) => circle.id !== circleId),
        };
      },
    );
  }

  queryClient.removeQueries({ queryKey: ["circle-intelligence", circleId], exact: true });
  queryClient.removeQueries({ queryKey: ["circle-stories", circleId], exact: true });
  queryClient.invalidateQueries({ queryKey: ["circles-map"] });
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
      invalidateCircleCaches(queryClient);
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
      fetchJson<CircleMetadataPatch>(`/api/circles/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: (circle, variables) => {
      patchCircleMetadataCaches(queryClient, circle);
      if (variables.followUpDays !== undefined) {
        queryClient.invalidateQueries({ queryKey: ["circles"], exact: true });
      }
    },
  });
}

export function useDeleteCircle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/circles/${id}`, { method: "DELETE" }),
    onSuccess: (_result, id) => {
      removeCircleFromCaches(queryClient, id);
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
      invalidateCircleCaches(queryClient);
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
      invalidateCircleCaches(queryClient);
    },
  });
}
