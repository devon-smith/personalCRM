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

/** Reference excerpt selected for this draft. Shape mirrors what the
 *  retrieval layer returns from the VoiceReference table — guidance
 *  is the Haiku-extracted structured advice, content is the raw text
 *  used for prompt-level inclusion. */
export interface VoiceReferenceForPrompt {
  readonly id: string;
  readonly filename: string;
  readonly sourceType: string;
  readonly content: string;
  readonly guidance: {
    readonly greetings: string[];
    readonly closings: string[];
    readonly signaturePhrases: string[];
    readonly avoidPhrases: string[];
    readonly toneNotes: string;
  } | null;
}

export interface BuildVoicePromptParams {
  /** The full per-user learned snapshot from VoiceProfile.learned. */
  learnedProfile: LearnedProfile | null;
  /** M0.x.12 — Jennifer's free-form custom voice instructions from
   *  /settings/voice. Rendered at the very top of the voice block as
   *  the highest-priority guidance. Trimmed and ignored when empty. */
  userInstructions?: string | null;
  /** The few-shot examples for this draft, top-K from retrieval. */
  examples: ReadonlyArray<VoiceExampleResult>;
  /** The recipient's relationship type — drives which bucket of the
   *  learned profile we render. */
  relationshipType: RelationshipType;
  /** M0.x.5: VoiceReferences applicable to this draft. Rendered
   *  FIRST and with explicit "primary — match these" framing so
   *  Jennifer's intentional voice (curated KB) dominates over her
   *  observed voice (sent-mail patterns). */
  references?: ReadonlyArray<VoiceReferenceForPrompt>;
}

/** Max chars per reference excerpt injected into the prompt.
 *  ~4000 chars ≈ ~1000 tokens — enough to convey style, bounded so
 *  three references don't blow the system-prompt budget. */
const REFERENCE_EXCERPT_CHARS = 4000;

/**
 * Whether voice-aware prompting can even apply. If false (no profile
 * indexed, no examples retrieved, no references uploaded), the caller
 * should fall back to the pre-M6.3 prompt path.
 */
export function hasVoiceContext(params: BuildVoicePromptParams): boolean {
  if (params.userInstructions && params.userInstructions.trim().length > 0) {
    return true;
  }
  if ((params.references?.length ?? 0) > 0) return true;
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

  // M0.x.12: user-typed instructions go FIRST, above even the
  // references. These are the most-authoritative voice signal —
  // explicitly typed by Jennifer with the intent of shaping every
  // outbound message. Reference materials embody her voice; these
  // are her instructions FOR the model. Direct trumps inferred.
  const instructions = params.userInstructions?.trim();
  if (instructions) {
    sections.push(buildInstructionsBlock(instructions));
  }

  // M0.x.5: voice references next. These represent Jennifer's
  // intentional voice (curated KB / style guide / humor manual) and
  // should dominate over the observed patterns from sent mail when
  // the two conflict.
  const refs = params.references ?? [];
  if (refs.length > 0) {
    sections.push(buildReferencesBlock(refs));
  }

  sections.push(
    `## How the user typically writes to ${humanizeType(params.relationshipType)}` +
      (refs.length > 0
        ? `\n_(secondary — use this for diction and structure; when it conflicts with the reference materials above, prefer the references)_`
        : ""),
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

  // Merge "never says": references' explicit anti-patterns + the
  // learned-from-emails neverSays. Dedup by exact match (case-sens).
  const learnedNever = params.learnedProfile?.neverSays ?? [];
  const referenceNever = refs.flatMap((r) => r.guidance?.avoidPhrases ?? []);
  const allNever = Array.from(new Set([...referenceNever, ...learnedNever]));
  if (allNever.length > 0) {
    sections.push(
      `## Phrases the user never uses\n` +
        (referenceNever.length > 0
          ? `Explicit anti-patterns from the reference materials, plus phrases that don't appear in their sent mail. Avoid all of these:\n`
          : `Avoid these — they don't appear anywhere in their sent mail:\n`) +
        allNever.map((p) => `- "${p}"`).join("\n"),
    );
  }

  return sections.join("\n\n");
}

/**
 * Build the "primary voice references" section. Pulled out so the
 * test surface stays small and we can swap the format later without
 * touching buildVoiceBlock.
 */
/**
 * M0.x.12 — render Jennifer's free-form custom voice instructions
 * as the topmost block. Exported for unit testing. Caller is
 * responsible for length sanity at write-time (we cap UI input at
 * 4000 chars; nothing here truncates further).
 */
export function buildInstructionsBlock(instructions: string): string {
  return (
    `## CUSTOM VOICE INSTRUCTIONS (highest priority — apply to every draft)\n` +
    `Jennifer typed these directly to shape how outbound messages sound. ` +
    `They override conflicting guidance from references, examples, or learned patterns:\n\n` +
    instructions
  );
}

export function buildReferencesBlock(
  references: ReadonlyArray<VoiceReferenceForPrompt>,
): string {
  const lines: string[] = [];
  lines.push(
    `## PRIMARY VOICE REFERENCES (highest priority — match these)`,
  );
  lines.push(
    `The user has explicitly curated these reference materials to describe their ideal writing voice. ` +
      `Match these reference examples in tone, humor, and rhythm above all else. ` +
      `When these references conflict with patterns inferred from their sent mail, favor the references — they represent how they WANT to write, not just how they have written.`,
  );

  references.forEach((ref, i) => {
    lines.push(renderReference(ref, i + 1));
  });

  return lines.join("\n\n");
}

function renderReference(
  ref: VoiceReferenceForPrompt,
  index: number,
): string {
  const lines: string[] = [];
  lines.push(`### REFERENCE ${index} — ${ref.filename}`);

  const g = ref.guidance;
  if (g) {
    if (g.toneNotes) {
      lines.push(`Tone & rhythm: ${g.toneNotes}`);
    }
    if (g.greetings.length > 0) {
      lines.push(
        `Preferred greetings: ${g.greetings.map((s) => `"${s}"`).join(", ")}`,
      );
    }
    if (g.closings.length > 0) {
      lines.push(
        `Preferred closings: ${g.closings.map((s) => `"${s}"`).join(", ")}`,
      );
    }
    if (g.signaturePhrases.length > 0) {
      lines.push(
        `Signature phrases to lean into:\n` +
          g.signaturePhrases.map((s) => `- "${s}"`).join("\n"),
      );
    }
  }

  const excerpt = ref.content.slice(0, REFERENCE_EXCERPT_CHARS);
  const truncMarker =
    ref.content.length > REFERENCE_EXCERPT_CHARS ? "\n\n[…truncated…]" : "";
  lines.push(`Excerpt:\n${excerpt}${truncMarker}`);

  return lines.join("\n\n");
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
