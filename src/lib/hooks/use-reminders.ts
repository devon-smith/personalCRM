import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { FollowUpContact } from "@/lib/types";

interface RemindersData {
  overdue: FollowUpContact[];
  upcoming: FollowUpContact[];
}

export function useReminders() {
  return useQuery<RemindersData>({
    queryKey: ["reminders"],
    queryFn: async () => {
      const res = await fetch("/api/reminders");
      if (!res.ok) throw new Error("Failed to fetch reminders");
      return res.json();
    },
  });
}

export function useLogInteraction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      contactId: string;
      type: string;
      direction: string;
      subject?: string;
      summary?: string;
      channel?: string;
    }) => {
      const res = await fetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to log interaction");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminders"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
