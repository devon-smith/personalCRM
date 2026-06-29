/**
 * Contact attribute extraction (M7.1).
 *
 * Given a contact + their interaction history, ask Claude Sonnet to
 * produce a structured ContactProfile: expertise areas, communication
 * style, geographic context, personality signals, relationship stage.
 *
 * Powers the "About them" section on the contact panel and is a key
 * input to the M7.3 reasoning graph queries ("Which former students
 * work in behavioral economics?", "Who in my network is in NYC?").
 *
 * Cost shape: one Claude Sonnet call per contact with ≥10 new
 * interactions since last extraction. Throttling lives in the worker
 * task (interactionsAtGeneration vs current count), not here — this
 * module is pure given an input bundle.
 */

import Anthropic from "@anthropic-ai/sdk";

const EXTRACT_MODEL = "claude-sonnet-4-6";
const EXTRACT_MAX_TOKENS = 1500;

export interface InteractionInput {
  type: string;
  direction: string;
  subject: string | null;
  summary: string | null;
  occurredAt: Date;
}

export interface JournalInput {
  content: string;
  mood: string | null;
  createdAt: Date;
}

export interface ContactInput {
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  notes: string | null;
  howWeMet: string | null;
  lastSeenScholarlyInstitution: string | null;
  circles: string[];
}

export interface ExtractAttributesInput {
  contact: ContactInput;
  interactions: ReadonlyArray<InteractionInput>;
  journalEntries: ReadonlyArray<JournalInput>;
}

export interface ExtractedAttributes {
  expertiseAreas: string[];
  communicationStyle: {
    formality: "casual" | "warm" | "formal" | "mixed";
    responseSpeed: "fast" | "medium" | "slow" | "unknown";
    length: "brief" | "moderate" | "long-form" | "mixed";
  } | null;
  geographicContext: {
    primaryLocation: string | null;
    travelFrequency: "low" | "medium" | "high" | "unknown";
  } | null;
  personalitySignals: {
    humor: "dry" | "warm" | "absent" | "playful" | "mixed";
    warmth: "high" | "medium" | "low";
    interests: string[];
  } | null;
  relationshipStage:
    | "new"
    | "peer"
    | "mentor"
    | "mentee"
    | "dormant"
    | "other"
    | null;
  rawAttributes: Record<string, unknown>;
}

/**
 * Top-level extraction entry point. Returns null on terminal failure
 * (no API key, malformed response we can't parse) — caller treats
 * null as "skip this contact this run, try again next cycle."
 */
export async function extractAttributes(
  input: ExtractAttributesInput,
): Promise<ExtractedAttributes | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  // Timeout + retry guard: the worker hung after 4 contacts on the
  // first run because the Anthropic SDK default per-request timeout
  // is effectively unbounded for connection-state edge cases. 60s
  // hard cap means a stuck call fails fast and the next contact
  // gets a turn. 2 retries on transient errors (429, 5xx, network).
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 60_000,
    maxRetries: 2,
  });
  const prompt = buildExtractionPrompt(input);

  try {
    const message = await anthropic.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: EXTRACT_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("");
    return parseExtractionResponse(text);
  } catch (err) {
    console.warn(
      `[extract-attributes] Claude call failed for ${input.contact.name}:`,
      err,
    );
    return null;
  }
}

// ─── Pure prompt builder (testable) ────────────────────────

const SYSTEM_PROMPT = `You're an analyst helping someone understand the people in their professional network. Given the contact's information and recent interactions, produce a structured profile.

CRITICAL RULES:
- Only assert things grounded in the data. If you don't have signal for a field, set it to null or "unknown" — do NOT invent.
- Expertise areas should be 1-5 specific phrases ("behavioral economics", "AI ethics"). Don't include vague labels ("smart", "successful").
- For string enums, pick the closest match from the listed options. If none fit, use the "mixed"/"other"/"unknown" variant.
- Personality signals are subjective inferences — only include them when 3+ interactions support the read.
- relationshipStage describes how the user knows this person now: new (recent contact), peer (regular collaborator), mentor (gives advice), mentee (receives advice), dormant (no contact in 6+ months), or other.

Return ONLY valid JSON matching this exact shape (no markdown, no preamble):

{
  "expertiseAreas": ["..."],
  "communicationStyle": { "formality": "casual" | "warm" | "formal" | "mixed", "responseSpeed": "fast" | "medium" | "slow" | "unknown", "length": "brief" | "moderate" | "long-form" | "mixed" } | null,
  "geographicContext": { "primaryLocation": "..." | null, "travelFrequency": "low" | "medium" | "high" | "unknown" } | null,
  "personalitySignals": { "humor": "dry" | "warm" | "absent" | "playful" | "mixed", "warmth": "high" | "medium" | "low", "interests": ["..."] } | null,
  "relationshipStage": "new" | "peer" | "mentor" | "mentee" | "dormant" | "other" | null,
  "rawAttributes": { /* any additional observations keyed by short phrase */ }
}`;

export function buildExtractionPrompt(input: ExtractAttributesInput): string {
  const { contact, interactions, journalEntries } = input;
  const parts: string[] = [];

  parts.push("## Contact");
  parts.push(`Name: ${contact.name}`);
  if (contact.email) parts.push(`Email: ${contact.email}`);
  if (contact.role || contact.company) {
    parts.push(
      `Current role: ${[contact.role, contact.company].filter(Boolean).join(" at ")}`,
    );
  }
  if (contact.lastSeenScholarlyInstitution) {
    parts.push(
      `Scholarly affiliation: ${contact.lastSeenScholarlyInstitution}`,
    );
  }
  const loc = [contact.city, contact.state, contact.country]
    .filter(Boolean)
    .join(", ");
  if (loc) parts.push(`Location on file: ${loc}`);
  if (contact.circles.length > 0) {
    parts.push(`Circles: ${contact.circles.join(", ")}`);
  }
  if (contact.howWeMet) parts.push(`How we met: ${contact.howWeMet}`);
  if (contact.notes) parts.push(`User's notes: ${contact.notes}`);

  if (interactions.length > 0) {
    parts.push("\n## Recent interactions (most recent first)");
    interactions.forEach((i) => {
      const date = i.occurredAt.toISOString().slice(0, 10);
      const subj = i.subject ? `"${i.subject}"` : "(no subject)";
      const summary = i.summary ? ` — ${i.summary}` : "";
      parts.push(`- ${date} ${i.type} (${i.direction}): ${subj}${summary}`);
    });
  }

  if (journalEntries.length > 0) {
    parts.push("\n## User's journal notes about this contact");
    journalEntries.forEach((j) => {
      const date = j.createdAt.toISOString().slice(0, 10);
      const mood = j.mood ? ` [${j.mood}]` : "";
      parts.push(`- ${date}${mood}: ${j.content.slice(0, 300)}`);
    });
  }

  parts.push("\n## Task");
  parts.push(
    "Produce a ContactProfile JSON matching the schema in the system prompt. Be conservative — null is better than inventing.",
  );

  return parts.join("\n");
}

// ─── Pure response parser (testable) ───────────────────────

/**
 * Parses Claude's response into the typed shape. Tolerates leading/
 * trailing prose ("Here is the JSON:") by extracting the first
 * balanced {...} block. Returns null if no valid JSON can be found.
 *
 * Validates enum fields against allowed values; unknown values are
 * normalized to the most permissive fallback ("mixed", "unknown",
 * "other") rather than rejected — Claude occasionally returns
 * close-but-not-exact strings and we'd rather keep partial data than
 * discard the whole extraction.
 */
export function parseExtractionResponse(
  text: string,
): ExtractedAttributes | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }

  return {
    expertiseAreas: normalizeStringArray(parsed.expertiseAreas),
    communicationStyle: normalizeCommunicationStyle(parsed.communicationStyle),
    geographicContext: normalizeGeographicContext(parsed.geographicContext),
    personalitySignals: normalizePersonalitySignals(parsed.personalitySignals),
    relationshipStage: normalizeRelationshipStage(parsed.relationshipStage),
    rawAttributes:
      typeof parsed.rawAttributes === "object" && parsed.rawAttributes !== null
        ? (parsed.rawAttributes as Record<string, unknown>)
        : {},
  };
}

function normalizeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, 10);
}

const FORMALITY = ["casual", "warm", "formal", "mixed"] as const;
const SPEED = ["fast", "medium", "slow", "unknown"] as const;
const LENGTH = ["brief", "moderate", "long-form", "mixed"] as const;
const FREQ = ["low", "medium", "high", "unknown"] as const;
const HUMOR = ["dry", "warm", "absent", "playful", "mixed"] as const;
const WARMTH = ["high", "medium", "low"] as const;
const STAGES = ["new", "peer", "mentor", "mentee", "dormant", "other"] as const;

function pick<T extends string>(
  v: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

function normalizeCommunicationStyle(
  v: unknown,
): ExtractedAttributes["communicationStyle"] {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return {
    formality: pick(o.formality, FORMALITY, "mixed"),
    responseSpeed: pick(o.responseSpeed, SPEED, "unknown"),
    length: pick(o.length, LENGTH, "mixed"),
  };
}

function normalizeGeographicContext(
  v: unknown,
): ExtractedAttributes["geographicContext"] {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return {
    primaryLocation:
      typeof o.primaryLocation === "string" ? o.primaryLocation : null,
    travelFrequency: pick(o.travelFrequency, FREQ, "unknown"),
  };
}

function normalizePersonalitySignals(
  v: unknown,
): ExtractedAttributes["personalitySignals"] {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return {
    humor: pick(o.humor, HUMOR, "mixed"),
    warmth: pick(o.warmth, WARMTH, "medium"),
    interests: normalizeStringArray(o.interests),
  };
}

function normalizeRelationshipStage(
  v: unknown,
): ExtractedAttributes["relationshipStage"] {
  if (typeof v !== "string") return null;
  return (STAGES as readonly string[]).includes(v)
    ? (v as (typeof STAGES)[number])
    : "other";
}
