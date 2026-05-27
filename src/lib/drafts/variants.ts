/**
 * Variant generator for the draft workspace (M0.x.6).
 *
 * Produces 3 alternate drafts that differ in tone/length so Jennifer
 * can compare side-by-side. Non-streaming — variants render together
 * and the model produces them in a single call.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getUserProfile } from "@/lib/user-profile";
import type { RefineContextSummary } from "./refine";

const VARIANTS_MODEL = "claude-sonnet-4-20250514";

export type VariantLabel = "shorter_direct" | "warmer_personal" | "with_humor";

export interface DraftVariant {
  readonly label: VariantLabel;
  readonly title: string;
  readonly content: string;
  readonly subjectLine: string | null;
}

const VARIANT_DEFS: Array<{ label: VariantLabel; title: string; instruction: string }> = [
  {
    label: "shorter_direct",
    title: "Shorter & more direct",
    instruction: "Cut everything non-essential. Tight, direct, no hedging.",
  },
  {
    label: "warmer_personal",
    title: "Warmer & more personal",
    instruction: "Warmer tone, more personal — reference shared context where appropriate.",
  },
  {
    label: "with_humor",
    title: "With a touch of humor",
    instruction: "Same core message, but with one light, dry, well-placed humorous moment.",
  },
];

const SYSTEM_PROMPT = (userName: string) =>
  `You are producing 3 alternate versions of an email draft for ${userName} so she can compare. Each variant should preserve the CORE MESSAGE — the same intent, the same recipient, the same ask — but differ in tone, length, and posture.

Return ONLY a single-line JSON object on its own line:
{"variants":[{"label":"shorter_direct","content":"...","subjectLine":"..."|null},{"label":"warmer_personal","content":"...","subjectLine":"..."|null},{"label":"with_humor","content":"...","subjectLine":"..."|null}]}

Each label maps to a distinct angle (the user-side prompt explains
which). "content" is the full draft body in plain text. "subjectLine"
is null when there's no subject (texts, casual notes).

No markdown, no preamble, no code fences. Just the JSON.`;

interface AnthropicLike {
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

let _client: AnthropicLike | null = null;
function getClient(): AnthropicLike {
  if (_client) return _client;
  _client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  }) as unknown as AnthropicLike;
  return _client;
}

export interface VariantsResult {
  readonly variants: DraftVariant[];
  readonly tokensIn: number;
  readonly tokensOut: number;
}

export function buildVariantsUserPrompt(
  currentDraft: string,
  currentSubjectLine: string | null,
  context: RefineContextSummary,
): string {
  const parts: string[] = [];

  // M0.x.12 — Jennifer's custom voice instructions apply to every
  // variant. Even the "with_humor" variant honors her overrides.
  const userInstructions = context.userInstructions?.trim();
  if (userInstructions) {
    parts.push(
      `CUSTOM VOICE INSTRUCTIONS (apply to ALL three variants):\n${userInstructions}\n`,
    );
  }

  parts.push(`RECIPIENT: ${context.recipientFullName} (${context.relationshipType})`);
  if (context.recipientEmail) parts.push(`Email: ${context.recipientEmail}`);

  if (context.replyContext) {
    const inb = context.replyContext.latestInbound;
    parts.push(
      `\nTHEY WROTE (this is the message being replied to):\n${truncate(inb.body, 1500)}`,
    );
  }

  if (context.references.length > 0) {
    parts.push(
      `\nVOICE REFERENCES — match the tone of these:\n${context.references
        .map((r) => `- ${r.filename}: ${truncate(r.guidance?.toneNotes ?? "", 200)}`)
        .join("\n")}`,
    );
  }

  parts.push(
    `\nCURRENT DRAFT (your starting point — vary FROM this):${
      currentSubjectLine ? `\nSubject: ${currentSubjectLine}\n` : "\n"
    }\n${currentDraft}`,
  );

  parts.push(`\nProduce 3 variants in this exact order:`);
  for (const def of VARIANT_DEFS) {
    parts.push(`- "${def.label}": ${def.instruction}`);
  }
  parts.push(`\nReturn the JSON object as specified.`);

  return parts.join("\n");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

export async function runVariants(args: {
  currentDraft: string;
  currentSubjectLine: string | null;
  context: RefineContextSummary;
}): Promise<VariantsResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  const profile = getUserProfile();
  const userPrompt = buildVariantsUserPrompt(
    args.currentDraft,
    args.currentSubjectLine,
    args.context,
  );
  const client = getClient();
  const response = await client.messages.create({
    model: VARIANTS_MODEL,
    max_tokens: 2400,
    system: SYSTEM_PROMPT(profile.firstName ?? "the user"),
    messages: [{ role: "user", content: userPrompt }],
  });
  const block = response.content[0];
  const text = block && block.type === "text" ? block.text ?? "" : "";
  const parsed = parseVariantsResponse(text);
  return {
    variants: parsed,
    tokensIn: response.usage?.input_tokens ?? 0,
    tokensOut: response.usage?.output_tokens ?? 0,
  };
}

export function parseVariantsResponse(text: string): DraftVariant[] {
  try {
    const trimmed = text.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : trimmed;
    const match = candidate.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const obj = JSON.parse(match[0]) as { variants?: unknown };
    if (!Array.isArray(obj.variants)) return [];
    const out: DraftVariant[] = [];
    for (const v of obj.variants) {
      if (!v || typeof v !== "object") continue;
      const rec = v as Record<string, unknown>;
      const label = rec.label as string;
      const def = VARIANT_DEFS.find((d) => d.label === label);
      if (!def) continue;
      if (typeof rec.content !== "string" || rec.content.length === 0) continue;
      out.push({
        label: def.label,
        title: def.title,
        content: rec.content,
        subjectLine:
          typeof rec.subjectLine === "string" && rec.subjectLine.length > 0
            ? rec.subjectLine
            : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export const VARIANTS_MODEL_NAME = VARIANTS_MODEL;
export { VARIANT_DEFS };
