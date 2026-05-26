/**
 * Per-contact conversational memory synthesis (M8.1).
 *
 * Distinct from M7.1's ContactProfile — profile holds STABLE
 * attributes (expertise, communication style); memory holds
 * CONVERSATIONAL state (what's been discussed, what's open, what
 * they mentioned about themselves).
 *
 * Generated incrementally: each pass receives the prior memory as
 * context plus new interactions since the last synthesis, and
 * produces an updated snapshot. The "EA's notebook" framing comes
 * from the plan's success criteria: "Memory for frequently-contacted
 * people reads like notes a thoughtful EA would keep."
 */

import Anthropic from "@anthropic-ai/sdk";

const SYNTHESIZE_MODEL = "claude-sonnet-4-20250514";
const SYNTHESIZE_MAX_TOKENS = 2000;

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
  company: string | null;
  role: string | null;
  notes: string | null;
}

export interface PriorMemory {
  discussedTopics: ReadonlyArray<DiscussedTopic>;
  theyMentioned: ReadonlyArray<TheyMentionedItem>;
  openThreads: ReadonlyArray<OpenThread>;
  personalContext: PersonalContext;
  recurringThemes: ReadonlyArray<string>;
}

export interface DiscussedTopic {
  topic: string;
  lastMentioned: string; // ISO date
  frequency: "once" | "occasional" | "frequent";
}

export interface TheyMentionedItem {
  subject: string;
  context: string;
  mentionedAt: string; // ISO date
}

export interface OpenThread {
  subject: string;
  raisedBy: "user" | "them";
  raisedAt: string; // ISO date
  status: "open" | "stale" | "resolved";
}

export interface PersonalContext {
  family?: string;
  location?: string;
  recentTransitions?: string;
  [key: string]: string | undefined;
}

export interface SynthesizeMemoryInput {
  contact: ContactInput;
  interactions: ReadonlyArray<InteractionInput>;
  journalEntries: ReadonlyArray<JournalInput>;
  /** Existing memory to update incrementally. Pass null for first synthesis. */
  priorMemory: PriorMemory | null;
}

export interface SynthesizedMemory {
  discussedTopics: DiscussedTopic[];
  theyMentioned: TheyMentionedItem[];
  openThreads: OpenThread[];
  personalContext: PersonalContext;
  recurringThemes: string[];
}

export async function synthesizeMemory(
  input: SynthesizeMemoryInput,
): Promise<SynthesizedMemory | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = buildSynthesisPrompt(input);

  try {
    const message = await anthropic.messages.create({
      model: SYNTHESIZE_MODEL,
      max_tokens: SYNTHESIZE_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("");
    return parseSynthesisResponse(text);
  } catch (err) {
    console.warn(
      `[synthesize-memory] Claude call failed for ${input.contact.name}:`,
      err,
    );
    return null;
  }
}

// ─── Pure helpers (testable) ───────────────────────────────

const SYSTEM_PROMPT = `You're a thoughtful executive assistant maintaining a notebook of conversational context per person in the user's network. You're given prior notes (if any) + recent interactions, and produce updated notes.

GOAL: notes should read like what an EA would jot down to help the user remember "what's going on with this person." Specific over generic. Concrete over hand-wavy.

CRITICAL RULES:
- Layer NEW interactions into the prior memory — don't discard prior context just because it wasn't reinforced this cycle.
- Mark threads "resolved" when the recent data shows they were addressed; "stale" when they've sat unaddressed for >30 days; "open" otherwise.
- DON'T invent things the data doesn't support. If you have no signal for personalContext.family or .location, omit those keys.
- theyMentioned is for THINGS THEY SAID about themselves (their daughter, their move, their book). Don't put YOUR observations about them there.
- recurringThemes is the 3-5 topics that keep coming back across multiple interactions. Distinct from one-off discussedTopics.

OUTPUT: return ONLY valid JSON in this shape (no markdown, no preamble):

{
  "discussedTopics": [
    { "topic": "Q3 product strategy", "lastMentioned": "2026-05-15", "frequency": "frequent" }
  ],
  "theyMentioned": [
    { "subject": "daughter applying to Stanford", "context": "Mentioned in May 12 email about visit planning", "mentionedAt": "2026-05-12" }
  ],
  "openThreads": [
    { "subject": "intro to Sarah Chen", "raisedBy": "them", "raisedAt": "2026-05-08", "status": "open" }
  ],
  "personalContext": { "location": "SF", "family": "wife Jess, two kids" },
  "recurringThemes": ["AI strategy", "team building"]
}

Frequencies: "once" / "occasional" (2-3x) / "frequent" (4+).
Statuses: "open" / "stale" (>30 days no movement) / "resolved".
RaisedBy: "user" or "them".
All dates as ISO YYYY-MM-DD.`;

export function buildSynthesisPrompt(input: SynthesizeMemoryInput): string {
  const { contact, interactions, journalEntries, priorMemory } = input;
  const parts: string[] = [];

  parts.push(`## Contact`);
  parts.push(`Name: ${contact.name}`);
  if (contact.role || contact.company) {
    parts.push(
      `Role: ${[contact.role, contact.company].filter(Boolean).join(" at ")}`,
    );
  }
  if (contact.notes) parts.push(`User's notes: ${contact.notes}`);

  if (priorMemory) {
    parts.push(`\n## Prior memory (your last synthesis)`);
    parts.push(JSON.stringify(priorMemory, null, 2));
  } else {
    parts.push(`\n## Prior memory: NONE — this is the first synthesis.`);
  }

  if (interactions.length > 0) {
    parts.push(`\n## Recent interactions (most recent first)`);
    for (const i of interactions) {
      const date = i.occurredAt.toISOString().slice(0, 10);
      const subj = i.subject ? `"${i.subject}"` : "(no subject)";
      const summary = i.summary ? ` — ${i.summary}` : "";
      parts.push(`- ${date} ${i.type} (${i.direction}): ${subj}${summary}`);
    }
  }

  if (journalEntries.length > 0) {
    parts.push(`\n## User's journal notes`);
    for (const j of journalEntries) {
      const date = j.createdAt.toISOString().slice(0, 10);
      const mood = j.mood ? ` [${j.mood}]` : "";
      parts.push(`- ${date}${mood}: ${j.content.slice(0, 400)}`);
    }
  }

  parts.push(
    `\n## Task\nProduce an updated ContactMemory JSON. Layer new signals into the prior memory — don't discard it. Be specific. Notes should help the user remember context they'd otherwise forget.`,
  );

  return parts.join("\n");
}

/**
 * Tolerant parser — extracts the first balanced {...} block, validates
 * enum fields, normalizes shapes. Returns null if no JSON found.
 */
export function parseSynthesisResponse(text: string): SynthesizedMemory | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }

  return {
    discussedTopics: normalizeDiscussedTopics(parsed.discussedTopics),
    theyMentioned: normalizeTheyMentioned(parsed.theyMentioned),
    openThreads: normalizeOpenThreads(parsed.openThreads),
    personalContext: normalizePersonalContext(parsed.personalContext),
    recurringThemes: normalizeStringArray(parsed.recurringThemes, 8),
  };
}

const FREQS = ["once", "occasional", "frequent"] as const;
const STATUSES = ["open", "stale", "resolved"] as const;
const RAISED_BY = ["user", "them"] as const;

function normalizeDiscussedTopics(v: unknown): DiscussedTopic[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((x) => ({
      topic: typeof x.topic === "string" ? x.topic : "",
      lastMentioned: typeof x.lastMentioned === "string" ? x.lastMentioned : "",
      frequency: pick(x.frequency, FREQS, "occasional"),
    }))
    .filter((t) => t.topic.length > 0)
    .slice(0, 20);
}

function normalizeTheyMentioned(v: unknown): TheyMentionedItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((x) => ({
      subject: typeof x.subject === "string" ? x.subject : "",
      context: typeof x.context === "string" ? x.context : "",
      mentionedAt: typeof x.mentionedAt === "string" ? x.mentionedAt : "",
    }))
    .filter((m) => m.subject.length > 0)
    .slice(0, 20);
}

function normalizeOpenThreads(v: unknown): OpenThread[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((x) => ({
      subject: typeof x.subject === "string" ? x.subject : "",
      raisedBy: pick(x.raisedBy, RAISED_BY, "them"),
      raisedAt: typeof x.raisedAt === "string" ? x.raisedAt : "",
      status: pick(x.status, STATUSES, "open"),
    }))
    .filter((t) => t.subject.length > 0)
    .slice(0, 15);
}

function normalizePersonalContext(v: unknown): PersonalContext {
  if (!v || typeof v !== "object") return {};
  const out: PersonalContext = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (typeof raw === "string" && raw.trim().length > 0) out[k] = raw;
  }
  return out;
}

function normalizeStringArray(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, cap);
}

function pick<T extends string>(
  v: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}
