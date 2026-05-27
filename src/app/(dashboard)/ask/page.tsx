"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { NetworkQueryBox } from "@/components/network-query/network-query-box";
import { HistoryPanel } from "@/components/ask/history-panel";

/**
 * /ask — natural-language network query workspace (M0.x.7).
 *
 * Replaces /queries. Top half is the current-query workspace (input
 * + most recent answer, owned by NetworkQueryBox with its
 * sessionStorage hydration). Bottom half is browsable history —
 * every past query auto-saved with its answer. "Re-run" lifts a
 * historical query back into the input.
 *
 * ?seed=<text> in the URL pre-fills the input and auto-runs (used
 * by /ask/[id]'s "Re-run this question" button).
 */

export default function AskPage() {
  const searchParams = useSearchParams();
  const seedParam = searchParams.get("seed");

  // Monotonic counter for re-seed keying. Pure — increments only in
  // click handlers + effects, never at render time.
  const seedCounter = useRef(0);

  // When Jennifer clicks "Re-run" in history we pass the query text
  // down to the box. The counter bumps on each new seed so identical
  // text re-runs still trigger the box's seedQuery effect.
  const [seed, setSeed] = useState<{ query: string; key: number } | null>(
    null,
  );

  // If the user navigates from /ask/[id] with ?seed=..., honor it once.
  // Subsequent visits without the param shouldn't re-seed.
  useEffect(() => {
    if (seedParam && !seed) {
      seedCounter.current += 1;
      setSeed({ query: seedParam, key: seedCounter.current });
    }
  }, [seedParam, seed]);

  const handleReRun = useCallback((queryText: string) => {
    seedCounter.current += 1;
    setSeed({ query: queryText, key: seedCounter.current });
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const handleSeedConsumed = useCallback(() => {
    setSeed(null);
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 sm:py-10 space-y-8">
      <header>
        <h1
          className="ds-display-md"
          style={{ color: "var(--text-primary)" }}
        >
          Ask anything about your network
        </h1>
        <p
          className="mt-1 text-[13px]"
          style={{ color: "var(--text-tertiary)" }}
        >
          Every question and answer is saved here. Star the ones you want to
          find again.
        </p>
      </header>

      {/* Current query workspace — the NetworkQueryBox already
          dominates with the input + answer panel + refinement. */}
      <NetworkQueryBox
        seedQuery={seed?.query ?? null}
        key={seed?.key ?? "initial"}
        onSeedConsumed={handleSeedConsumed}
      />

      <div
        className="h-px"
        style={{ backgroundColor: "var(--border)" }}
      />

      <HistoryPanel onReRun={handleReRun} />
    </div>
  );
}
