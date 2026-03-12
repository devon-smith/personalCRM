"use client";

import { useQuery } from "@tanstack/react-query";
import type { ContactMomentum } from "@/lib/momentum";

interface MomentumResponse {
  readonly momentum: readonly ContactMomentum[];
}

export function useMomentum(contactIds: readonly string[]) {
  const idsParam = contactIds.join(",");

  return useQuery<MomentumResponse>({
    queryKey: ["momentum", idsParam],
    queryFn: async () => {
      if (contactIds.length === 0) return { momentum: [] };
      const res = await fetch(`/api/momentum?contactIds=${encodeURIComponent(idsParam)}`);
      if (!res.ok) return { momentum: [] };
      return res.json();
    },
    enabled: contactIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5 min cache
  });
}
