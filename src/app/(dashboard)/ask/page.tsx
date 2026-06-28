"use client";

import { Suspense } from "react";
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

const ASK_PROMPTS = [
  "What do I know about Priya Anand?",
  "Who haven't I talked to in 3 months?",
  "Which grants have upcoming deadlines?",
  "Who in my Research circle is stale?",
];

export default function AskPage() {
  return (
    <Suspense fallback={<AskPageShell />}>
      <AskPageContent />
    </Suspense>
  );
}

function AskPageContent() {
  const searchParams = useSearchParams();
  const seedParam = searchParams.get("seed");

  // Monotonic counters for prop-triggered actions. Pure — increments
  // only in click handlers + effects, never at render time.
  const seedCounter = useRef(0);
  const draftCounter = useRef(0);

  // When Jennifer clicks "Re-run" in history we pass the query text
  // down to the box. The counter bumps on each new seed so identical
  // text re-runs still trigger the box's seedQuery effect.
  const [seed, setSeed] = useState<{ query: string; key: number } | null>(
    null,
  );
  const [draft, setDraft] = useState<{ query: string; key: number } | null>(
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

  const handleShortcutFill = useCallback((queryText: string) => {
    draftCounter.current += 1;
    setDraft({ query: queryText, key: draftCounter.current });
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const handleDraftConsumed = useCallback(() => {
    setDraft(null);
  }, []);

  return (
    <div className="mx-auto w-full max-w-[936px] px-4 sm:px-6 py-8 sm:py-12 space-y-9">
      <header className="text-center">
        <p
          className="text-[12px] font-semibold uppercase tracking-[0.28em]"
          style={{ color: "#B8613D" }}
        >
          Research Assistant
        </p>
        <h1
          className="ds-display-md mt-1"
          style={{ color: "#1F1D1A", fontSize: "clamp(2.1rem, 4vw, 3rem)" }}
        >
          Ask about your relationships
        </h1>
        <p
          className="mt-1 font-serif text-[17px] italic sm:text-[19px]"
          style={{ color: "#7E776E" }}
        >
          Answers are grounded in your emails, notes, facts, and interactions.
        </p>
      </header>

      <section className="space-y-4">
        <NetworkQueryBox
          seedQuery={seed?.query ?? null}
          seedQueryKey={seed?.key ?? null}
          onSeedConsumed={handleSeedConsumed}
          draftQuery={draft?.query ?? null}
          draftQueryKey={draft?.key ?? null}
          onDraftConsumed={handleDraftConsumed}
          placeholder="Who did I promise to follow up with?"
        />
        <div className="flex flex-wrap justify-center gap-2">
          {ASK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => handleShortcutFill(prompt)}
              className="rounded-full border px-4 py-2 text-[14px] font-medium transition-colors hover:bg-white"
              style={{
                borderColor: "#E4DACB",
                backgroundColor: "#F8F3EA",
                color: "#6B6258",
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      </section>

      <div
        className="h-px"
        style={{ backgroundColor: "#E9E0D4" }}
      />

      <HistoryPanel onReRun={handleReRun} />
    </div>
  );
}

function AskPageShell() {
  return (
    <div className="mx-auto w-full max-w-[936px] px-4 sm:px-6 py-8 sm:py-12 space-y-8">
      <header className="text-center">
        <p
          className="text-[12px] font-semibold uppercase tracking-[0.28em]"
          style={{ color: "#B8613D" }}
        >
          Research Assistant
        </p>
        <h1
          className="ds-display-md mt-1"
          style={{ color: "#1F1D1A", fontSize: "clamp(2.1rem, 4vw, 3rem)" }}
        >
          Ask about your relationships
        </h1>
        <p
          className="mt-1 font-serif text-[17px] italic sm:text-[19px]"
          style={{ color: "#7E776E" }}
        >
          Loading your query workspace...
        </p>
      </header>
    </div>
  );
}
