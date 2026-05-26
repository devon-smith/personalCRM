/**
 * Voice-aware draft prompt construction (M6.3.3).
 *
 * Takes the learned voice profile + a handful of similar past emails,
 * produces the system-prompt blocks that go into the Claude draft
 * generation call. Pure function — no IO, no SDK calls — so it's
 * unit-testable in isolation.
 *
 * The output is a tuple of strings designed for Anthropic's prompt-
 * caching shape: the base instruction block stays static across all
 * drafts, the voice block is stable per (user × relationship type) so
 * Jennifer drafting multiple casual emails in one session re-uses it.
 */

import type {
  LearnedProfile,
  LearnedRelationshipBucket,
} from "./profile";
import type { RelationshipType } from "./relationship-classifier";
import type { VoiceExampleResult } from "./few-shot-retrieval";

export interface BuildVoicePromptParams {
  /** The full per-user learned snapshot from VoiceProfile.learned. */
  learnedProfile: LearnedProfile | null;
  /** The few-shot examples for this draft, top-K from retrieval. */
  examples: ReadonlyArray<VoiceExampleResult>;
  /** The recipient's relationship type — drives which bucket of the
   *  learned profile we render. */
  relationshipType: RelationshipType;
}

/**
 * Whether voice-aware prompting can even apply. If false (no profile
 * indexed, no examples retrieved), the caller should fall back to the
 * pre-M6.3 prompt path.
 */
export function hasVoiceContext(params: BuildVoicePromptParams): boolean {
  if (params.examples.length > 0) return true;
  const bucket = params.learnedProfile?.byRelationship?.[params.relationshipType];
  return (bucket?.count ?? 0) > 0;
}

/**
 * Build the voice block to inject into the system prompt. Returns null
 * if there's no voice context to render — caller falls back to the
 * pre-M6.3 path. Returned text is intended to be marked with
 * `cache_control: { type: "ephemeral" }` by the caller.
 */
export function buildVoiceBlock(params: BuildVoicePromptParams): string | null {
  if (!hasVoiceContext(params)) return null;

  const sections: string[] = [];
  sections.push(
    `## How the user typically writes to ${humanizeType(params.relationshipType)}`,
  );

  const bucket =
    params.learnedProfile?.byRelationship?.[params.relationshipType] ?? null;
  if (bucket && bucket.count > 0) {
    sections.push(renderBucketSummary(bucket));
  }

  if (params.examples.length > 0) {
    sections.push(
      `Here are ${params.examples.length} actual emails the user wrote to similar contacts. ` +
        `Match the cadence, opening style, vocabulary, and length. Don't copy any single example verbatim — synthesize the pattern.`,
    );
    params.examples.forEach((ex, i) => {
      sections.push(renderExample(ex, i + 1));
    });
  }

  if (params.learnedProfile && params.learnedProfile.neverSays.length > 0) {
    sections.push(
      `## Phrases the user never uses\n` +
        `Avoid these — they don't appear anywhere in their sent mail:\n` +
        params.learnedProfile.neverSays.map((p) => `- "${p}"`).join("\n"),
    );
  }

  return sections.join("\n\n");
}

/**
 * Closing-style guidance derived from the learned profile. If the
 * user almost never writes an explicit closing in this relationship
 * type, tell the model not to add one (the sig block handles it on
 * send). This was the M6.1.1 insight: 90% "none" in casual closings
 * is real voice, not missing data.
 */
export function buildClosingGuidance(params: BuildVoicePromptParams): string {
  const bucket =
    params.learnedProfile?.byRelationship?.[params.relationshipType] ?? null;
  if (!bucket || bucket.count === 0) return "";

  const noneClosing = bucket.closings.find((c) => c.value === "none");
  if (noneClosing && noneClosing.pct >= 60) {
    return (
      `IMPORTANT closing rule for this recipient type: the user usually does NOT write an explicit closing line ` +
        `("Best,", "Warmly," etc.) — their signature block handles sign-off on send. ` +
        `${noneClosing.pct}% of their emails to ${humanizeType(params.relationshipType)} end with content, no closing. ` +
        `Match this. End the draft on the last content sentence.`
    );
  }

  // Otherwise, surface the top closing they do use.
  const top = bucket.closings[0];
  if (top && top.value !== "none" && top.value !== "other") {
    return (
      `Closing: the user typically signs ${humanizeClosing(top.value)} to ${humanizeType(params.relationshipType)} ` +
        `(${top.pct}% of their emails). Use that pattern unless context makes it inappropriate.`
    );
  }
  return "";
}

// ─── Renderers (pure, testable) ────────────────────────────

function renderBucketSummary(bucket: LearnedRelationshipBucket): string {
  const lines: string[] = [];
  lines.push(
    `Based on ${bucket.count} of the user's past emails to people in this relationship:`,
  );
  if (bucket.greetings.length > 0) {
    const top = bucket.greetings.slice(0, 2);
    lines.push(
      `- Greetings: ${top.map((g) => `${humanizeOpening(g.value)} (${g.pct}%)`).join(", ")}`,
    );
  }
  if (bucket.avgSentenceLen > 0) {
    lines.push(
      `- Sentence rhythm: ~${bucket.avgSentenceLen} words per sentence on average`,
    );
  }
  if (bucket.wordCountMedian > 0) {
    lines.push(`- Typical email length: ~${bucket.wordCountMedian} words`);
  }
  if (bucket.signaturePhrases.length > 0) {
    const top = bucket.signaturePhrases.slice(0, 6);
    lines.push(
      `- Recurring signature phrases (use naturally where they fit):\n` +
        top.map((p) => `  · "${p.value}" (appears ${p.count}×)`).join("\n"),
    );
  }
  return lines.join("\n");
}

function renderExample(ex: VoiceExampleResult, index: number): string {
  const dateStr = ex.sentAt.toISOString().slice(0, 10);
  const toLabel = ex.recipientName ?? ex.toEmail;
  const fallbackTag =
    ex.matchKind === "fallback" ? " (cross-type — closest available)" : "";
  return (
    `### EXAMPLE ${index} — to ${toLabel}, ${dateStr}${fallbackTag}\n` +
    `${ex.body.trim()}`
  );
}

// ─── Humanization helpers ──────────────────────────────────

function humanizeType(t: RelationshipType): string {
  switch (t) {
    case "former_student":
      return "former students";
    case "peer_faculty":
      return "peer faculty / academics";
    case "industry_exec":
      return "industry executives";
    case "media":
      return "media contacts";
    case "family":
      return "family";
    case "board":
      return "board members / advisors";
    case "casual":
      return "close friends / casual contacts";
    case "unknown":
      return "contacts (relationship type uncertain)";
  }
}

function humanizeOpening(value: string): string {
  switch (value) {
    case "first_name":
      return '"Marc," (just first name)';
    case "hi":
      return '"Hi,"';
    case "hey":
      return '"Hey,"';
    case "hello":
      return '"Hello,"';
    case "dear":
      return '"Dear,"';
    case "none":
      return "(no greeting — straight into content)";
    case "other":
      return "(varied)";
    default:
      return value;
  }
}

function humanizeClosing(value: string): string {
  switch (value) {
    case "warmly":
      return '"Warmly,"';
    case "best":
      return '"Best,"';
    case "cheers":
      return '"Cheers,"';
    case "thanks":
      return '"Thanks,"';
    case "thank_you":
      return '"Thank you,"';
    case "sincerely":
      return '"Sincerely,"';
    case "regards":
      return '"Regards,"';
    case "talk_soon":
      return '"Talk soon,"';
    case "xo":
      return '"xo"';
    default:
      return `"${value}"`;
  }
}
