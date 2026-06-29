"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import Link from "next/link";
import type { DashboardBootstrapResponse } from "@/app/api/dashboard/bootstrap/route";

/**
 * "Notes from your assistant" — unprompted dashboard observations
 * (M9.2). Self-hides when empty. Up to 2 visible at a time, each
 * dismissible.
 *
 * Conscious calm-tone design choices per the plan:
 *   - No "URGENT" / "ACTION REQUIRED" framing
 *   - No badge counter
 *   - No spinner — the data is already there or it isn't
 *   - Single subtle sparkle icon to mark "from the assistant"
 */

const VISIBLE_COUNT = 2;
type Observation = DashboardBootstrapResponse["observations"][number];

export function AssistantObservations({
  initialObservations,
}: {
  initialObservations: Observation[];
}) {
  const qc = useQueryClient();
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());

  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/observations/${id}/dismiss`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Dismiss failed");
    },
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["dashboard"] });
      const prevHiddenIds = hiddenIds;
      const prevDashboard =
        qc.getQueryData<DashboardBootstrapResponse>(["dashboard"]);

      setHiddenIds((current) => new Set(current).add(id));
      qc.setQueryData<DashboardBootstrapResponse>(
        ["dashboard"],
        (old) => old
          ? {
              ...old,
              observations: old.observations.filter((o) => o.id !== id),
            }
          : old,
      );
      return { prevHiddenIds, prevDashboard };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prevHiddenIds) setHiddenIds(ctx.prevHiddenIds);
      if (ctx?.prevDashboard) qc.setQueryData(["dashboard"], ctx.prevDashboard);
    },
  });

  const observations = initialObservations
    .filter((o) => !hiddenIds.has(o.id))
    .slice(0, VISIBLE_COUNT);
  if (observations.length === 0) return null;

  return (
    <section
      aria-label="Notes from your assistant"
      className="space-y-2"
    >
      <div
        className="text-[11px] uppercase tracking-wider"
        style={{ color: "#8C8A82" }}
      >
        Notes from your assistant
      </div>
      <ul className="space-y-2">
        {observations.map((o) => (
          <li key={o.id}>
            <div
              className="flex items-start gap-2.5 rounded-2xl p-3 transition-colors"
              style={{
                backgroundColor: "#F4EFE3",
                border: "1px solid #ECE7D9",
              }}
            >
              <Sparkles
                className="h-3.5 w-3.5 mt-1 shrink-0"
                style={{ color: "#7A4F3C" }}
              />
              <div className="flex-1 min-w-0">
                {o.contactId ? (
                  <Link
                    href={`/people?contact=${o.contactId}`}
                    className="text-[13px] leading-relaxed hover:underline"
                    style={{ color: "#1B1A17" }}
                  >
                    {o.content}
                  </Link>
                ) : (
                  <span
                    className="text-[13px] leading-relaxed"
                    style={{ color: "#1B1A17" }}
                  >
                    {o.content}
                  </span>
                )}
              </div>
              <button
                onClick={() => dismiss.mutate(o.id)}
                aria-label="Dismiss"
                className="shrink-0 p-1 rounded-md transition-colors"
                style={{ color: "#8C8A82" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#5A574F";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#8C8A82";
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
