import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { JobApplication } from "@/generated/prisma/client";
import type { JobStatus } from "@/generated/prisma/enums";

// Flexible input type for mutations (dates as strings, etc.)
type JobInput = {
  id?: string;
  company?: string;
  roleTitle?: string;
  url?: string | null;
  status?: JobStatus;
  salaryRange?: string | null;
  deadline?: string | null;
  notes?: string | null;
};

export type JobWithContacts = JobApplication & {
  contacts: { id: string; name: string; avatarUrl: string | null }[];
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function useJobs() {
  return useQuery<JobWithContacts[]>({
    queryKey: ["jobs"],
    queryFn: () => fetchJson("/api/jobs"),
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: JobInput) =>
      fetchJson<JobWithContacts>("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: JobInput & { id: string }) =>
      fetchJson<JobWithContacts>(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/jobs/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
