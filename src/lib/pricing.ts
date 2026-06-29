/**
 * Model pricing (M0.x.14).
 *
 * Per-million-token rates in USD as of late 2026. Update when Anthropic
 * publishes new rates or we add a new model. The cost dashboard
 * (/settings/usage) multiplies AIGenerationLog token counts by these
 * rates to estimate spend per feature / per model.
 *
 * Voyage prices are input-only (embeddings have no output side).
 * Web-search APIs (Brave, Anthropic) bill per-call, not per-token —
 * counted separately by `searchCallCount`.
 */

export interface ModelPrice {
  /** USD per 1M input tokens. */
  inputPerMillion: number;
  /** USD per 1M output tokens. 0 for embedding-only models. */
  outputPerMillion: number;
  /** Display label for the dashboard. */
  label: string;
  /** Provider name for grouping. */
  provider: "anthropic" | "voyage" | "openai" | "unknown";
}

const PRICING: Record<string, ModelPrice> = {
  // ─── Claude (Anthropic) ──────────────────────────────────
  "claude-opus-4-7": {
    inputPerMillion: 15,
    outputPerMillion: 75,
    label: "Claude Opus 4.7",
    provider: "anthropic",
  },
  "claude-sonnet-4-6": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
  },
  "claude-sonnet-4-5": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    label: "Claude Sonnet 4.5",
    provider: "anthropic",
  },
  // The pinned-version Sonnet IDs we actually call in code.
  "claude-sonnet-4-20250514": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    label: "Claude Sonnet 4",
    provider: "anthropic",
  },
  "claude-haiku-4-5-20251001": {
    inputPerMillion: 1,
    outputPerMillion: 5,
    label: "Claude Haiku 4.5",
    provider: "anthropic",
  },
  // ─── Voyage ───────────────────────────────────────────────
  "voyage-3-lite": {
    inputPerMillion: 0.02,
    outputPerMillion: 0,
    label: "Voyage 3 Lite (embeddings)",
    provider: "voyage",
  },
  // ─── OpenAI Whisper (voice memo transcription) ────────────
  "whisper-1": {
    // Whisper is billed at $0.006/min, not per-token. Cost dashboard
    // treats `tokensIn` as a placeholder (it's the duration in
    // hundredths of seconds in our log convention), so the rate
    // shown here is a rough approximation: $0.006/min ≈ $0.0001/sec.
    // The dashboard surfaces these rows under a "Transcription" line
    // item with a note that the number is approximate.
    inputPerMillion: 0.1,
    outputPerMillion: 0,
    label: "OpenAI Whisper",
    provider: "openai",
  },
};

/** Default rate for unknown models — flags them in the UI as "Unknown". */
const FALLBACK_PRICE: ModelPrice = {
  inputPerMillion: 0,
  outputPerMillion: 0,
  label: "Unknown model",
  provider: "unknown",
};

export function priceFor(model: string): ModelPrice {
  return PRICING[model] ?? FALLBACK_PRICE;
}

/** Estimated USD cost for one row's token spend. */
export function estimateCost(
  model: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const p = priceFor(model);
  const inputCost = (tokensIn / 1_000_000) * p.inputPerMillion;
  const outputCost = (tokensOut / 1_000_000) * p.outputPerMillion;
  return inputCost + outputCost;
}

/** Human label for a feature key (matches what worker writes). */
export const FEATURE_LABELS: Record<string, string> = {
  draft: "Draft generation",
  draft_refine: "Draft refinement",
  draft_variants: "Draft variants",
  inbox_classify: "Inbox classification",
  life_event_extract: "Life-event extraction",
  morning_brief: "Morning brief",
  network_query: "Network queries (/ask)",
  voice_transcribe: "Voice transcription",
  voice_reference_guidance: "Voice reference parsing",
  meeting_prep_web_search: "Meeting prep — web search",
  brave_search: "Network search (Brave)",
  contact_search: "Contact semantic search",
  contact_embedding_refresh: "Contact embedding refresh",
  contact_embedding_backfill: "Contact embedding backfill",
  draft_context_voice_references: "Draft voice reference search",
  draft_voice_context: "Draft voice context search",
  voice_few_shot_retrieval: "Voice example retrieval",
  voice_reference_upload: "Voice reference upload",
  voice_corpus_email_index: "Voice corpus indexing — email",
  gmail_draft_thread_scan: "Gmail draft scan",
  gmail_draft_save: "Gmail draft save",
  gmail_draft_send: "Gmail draft send",
};

export function featureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature;
}

export const KNOWN_MODELS = Object.keys(PRICING);
