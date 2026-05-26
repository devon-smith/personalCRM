"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import Link from "next/link";

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

interface Observation {
  id: string;
  content: string;
  contactId: string | null;
  source: string;
  createdAt: string;
}

const VISIBLE_COUNT = 2;

export function AssistantObservations() {
  const qc = useQueryClient();
  const { data } = useQuery<{ observations: Observation[] }>({
    queryKey: ["observations"],
    queryFn: async () => {
      const res = await fetch("/api/observations");
      if (!res.ok) throw new Error("Failed to load observations");
      return res.json();
    },
  });

  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/observations/${id}/dismiss`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Dismiss failed");
    },
    onMutate: async (id: string) => {
      // Optimistic: drop it from the list immediately.
      await qc.cancelQueries({ queryKey: ["observations"] });
      const prev = qc.getQueryData<{ observations: Observation[] }>([
        "observations",
      ]);
      qc.setQueryData<{ observations: Observation[] }>(
        ["observations"],
        (old) =>
          old
            ? { observations: old.observations.filter((o) => o.id !== id) }
            : old,
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["observations"], ctx.prev);
    },
  });

  const observations = data?.observations.slice(0, VISIBLE_COUNT) ?? [];
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
