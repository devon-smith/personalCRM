/**
 * Haiku-extracted style guidance from a VoiceReference (M0.x.5).
 *
 * Reads the raw KB/style-guide text and produces structured guidance
 * the prompt builder merges into the voice block at draft time. The
 * spec ("Writer's Room — Humor Helper" knowledge base) is what
 * Jennifer wants to optimize for — this extraction layer lets us
 * inject specific greeting/closing/phrase guidance into the prompt
 * rather than dumping the whole 50KB file every draft.
 *
 * Idempotent + fail-soft. If the Haiku call errors, we return a
 * minimal guidance shape so the wholesale text injection still
 * happens — the reference is never "lost," just not summarized.
 */

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";

export const APPLICABLE_ALL = "all" as const;
export type ApplicableRelationship = string | typeof APPLICABLE_ALL;

export interface ExtractedGuidance {
  /** "all" or a list of relationship-classifier buckets this guidance applies to. */
  applicableRelationships: ApplicableRelationship[];
  /** Preferred greetings, in priority order. */
  greetings: string[];
  /** Preferred closings / sign-offs, in priority order. */
  closings: string[];
  /** Phrases / cadences the model should LEAN INTO. */
  signaturePhrases: string[];
  /** Phrases the model must NEVER use (anti-patterns). */
  avoidPhrases: string[];
  /** 1-3 sentence prose summary of the desired tone + rhythm. */
  toneNotes: string;
  /** Raw token usage from the extraction call (for AIGenerationLog). */
  tokensIn?: number;
  tokensOut?: number;
}

const SYSTEM_PROMPT = `You are reading a writing reference (a knowledge base file, style guide, humor manual, or book excerpt) that someone has curated to describe their ideal writing voice. Extract structured guidance from it.

Return ONLY a JSON object with this exact shape:
{
  "applicableRelationships": ["all"] | ["former_student", "peer_faculty", ...],
  "greetings": ["string", ...],
  "closings": ["string", ...],
  "signaturePhrases": ["string", ...],
  "avoidPhrases": ["string", ...],
  "toneNotes": "string"
}

Rules:
- Use "all" as the only entry of applicableRelationships when the reference is general. Use specific relationship types ONLY when the reference explicitly addresses a particular audience. Valid relationships: former_student, peer_faculty, industry_exec, media, family, board, casual.
- greetings/closings/signaturePhrases: extract EXACT verbatim text the reference recommends or demonstrates. Limit to the 5 strongest signals each.
- avoidPhrases: extract phrases the reference EXPLICITLY warns against ("never say X", "avoid Y"). Limit to 8. Skip if no anti-patterns are mentioned.
- toneNotes: 1-3 sentences that capture the rhythm / humor / posture the reference is teaching. Plain prose.
- If a category isn't supported by the reference, return an empty array (or empty string for toneNotes). Do NOT invent guidance.
- Return ONLY the JSON. No prose, no markdown fences.`;

interface AnthropicClientLike {
  messages: {
    create: (args: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: "user"; content: string }>;
    }) => Promise<{
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
}

let _client: AnthropicClientLike | null = null;
function getClient(): AnthropicClientLike {
  if (_client) return _client;
  _client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  }) as unknown as AnthropicClientLike;
  return _client;
}

const VALID_RELATIONSHIPS = new Set([
  "all",
  "former_student",
  "peer_faculty",
  "industry_exec",
  "media",
  "family",
  "board",
  "casual",
  "unknown",
]);

export function parseGuidanceResponse(text: string): Omit<
  ExtractedGuidance,
  "tokensIn" | "tokensOut"
> {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return emptyGuidance();
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const rawRel = Array.isArray(parsed.applicableRelationships)
      ? (parsed.applicableRelationships as unknown[])
      : ["all"];
    const applicable = rawRel
      .filter((r): r is string => typeof r === "string")
      .filter((r) => VALID_RELATIONSHIPS.has(r));
    return {
      applicableRelationships: applicable.length > 0 ? applicable : ["all"],
      greetings: asStringArray(parsed.greetings, 5),
      closings: asStringArray(parsed.closings, 5),
      signaturePhrases: asStringArray(parsed.signaturePhrases, 5),
      avoidPhrases: asStringArray(parsed.avoidPhrases, 8),
      toneNotes:
        typeof parsed.toneNotes === "string"
          ? parsed.toneNotes.trim().slice(0, 600)
          : "",
    };
  } catch {
    return emptyGuidance();
  }
}

function emptyGuidance(): Omit<ExtractedGuidance, "tokensIn" | "tokensOut"> {
  return {
    applicableRelationships: ["all"],
    greetings: [],
    closings: [],
    signaturePhrases: [],
    avoidPhrases: [],
    toneNotes: "",
  };
}

function asStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, max);
}

/**
 * Run Haiku against the reference text. Fail-soft: returns an empty
 * guidance shape on any error so the caller can still persist the
 * row and inject the raw text as wholesale prompt context.
 */
export async function extractGuidance(text: string): Promise<ExtractedGuidance> {
  if (!process.env.ANTHROPIC_API_KEY) return emptyGuidance();
  // Cap input to ~12KB (~3K tokens) so we don't burn tokens on a
  // very long KB file. The KB's first chunk is usually the most
  // representative for style.
  const input = text.slice(0, 12_000);
  try {
    const client = getClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: input }],
    });
    const block = response.content[0];
    const responseText =
      block && block.type === "text" ? block.text ?? "" : "";
    return {
      ...parseGuidanceResponse(responseText),
      tokensIn: response.usage?.input_tokens,
      tokensOut: response.usage?.output_tokens,
    };
  } catch {
    return emptyGuidance();
  }
}

export const GUIDANCE_MODEL = MODEL;
