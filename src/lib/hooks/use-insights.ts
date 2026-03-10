"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface HealthInsight {
  healthScore: number;
  healthLabel: "thriving" | "stable" | "fading" | "dormant";
  summary: string;
  actions: string[];
  cached: boolean;
}

export interface CachedInsight extends HealthInsight {
  contact: {
    id: string;
    name: string;
    company: string | null;
    tier: string;
    avatarUrl: string | null;
  };
}

export interface DigestData {
  digest: {
    highlights: string[];
    needsAttention: Array<{ name: string; reason: string }>;
    suggestedActions: string[];
    stats: {
      totalInteractions: number;
      contactsReached: number;
      newContacts: number;
    };
  };
  cached: boolean;
  generatedAt: string;
}

export interface IntroductionSuggestion {
  contact1: { id: string; name: string };
  contact2: { id: string; name: string };
  reason: string;
  icebreaker: string;
}

export function useRelationshipHealth(contactId: string | null) {
  return useQuery<HealthInsight>({
    queryKey: ["health", contactId],
    queryFn: async () => {
      const res = await fetch("/api/ai/relationship-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      if (!res.ok) throw new Error("Failed to fetch health score");
      return res.json();
    },
    enabled: !!contactId,
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}

export function useComputeHealth() {
  const queryClient = useQueryClient();
  return useMutation<HealthInsight, Error, string>({
    mutationFn: async (contactId: string) => {
      const res = await fetch("/api/ai/relationship-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      if (!res.ok) throw new Error("Failed to compute health");
      return res.json();
    },
    onSuccess: (_data, contactId) => {
      queryClient.invalidateQueries({ queryKey: ["health", contactId] });
      queryClient.invalidateQueries({ queryKey: ["health-all"] });
    },
  });
}

export function useAllHealthInsights() {
  return useQuery<{ insights: CachedInsight[] }>({
    queryKey: ["health-all"],
    queryFn: async () => {
      const res = await fetch("/api/ai/relationship-health");
      if (!res.ok) throw new Error("Failed to fetch insights");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useWeeklyDigest() {
  return useQuery<DigestData>({
    queryKey: ["weekly-digest"],
    queryFn: async () => {
      const res = await fetch("/api/ai/weekly-digest");
      if (!res.ok) throw new Error("Failed to fetch digest");
      return res.json();
    },
    staleTime: 30 * 60 * 1000, // 30 minutes
  });
}

export function useSuggestedIntroductions() {
  return useQuery<{ introductions: IntroductionSuggestion[] }>({
    queryKey: ["introductions"],
    queryFn: async () => {
      const res = await fetch("/api/ai/suggest-introductions");
      if (!res.ok) throw new Error("Failed to fetch introductions");
      return res.json();
    },
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}
