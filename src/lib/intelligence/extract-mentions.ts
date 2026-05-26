/**
 * Per-email mention extraction (M7.2 expansion).
 *
 * Given an email body, asks Claude Haiku to extract names of people
 * mentioned in the text (excluding the sender and recipient — those
 * are already on the EmailMessage row). Used by the mention-
 * extraction worker to populate `mentionedContactIds` on each
 * EmailMessage, which downstream becomes `mentioned` edges in
 * ContactEdge.
 *
 * Why Haiku rather than regex / substring matching against
 * Contact.name:
 *   - First-name-only mentions ("told Marc about the talk") need
 *     entity context to disambiguate
 *   - "We had lunch with Sarah and her friend Alex" — relational
 *     extraction is easier for an LLM than for regex
 *   - Pronouns + nicknames + initials all collapse correctly with
 *     a model that's read the rest of the email
 *
 * Cost shape: ~$0.001 per call. 50 emails/run × $0.001 = $0.05/run.
 * Daily cron at 100/day chews through a 5K-email backlog in ~50 days
 * — fine, since edges accumulate; the graph gets richer over time.
 */

import Anthropic from "@anthropic-ai/sdk";

const MENTION_MODEL = "claude-haiku-4-5-20251001";
const MENTION_MAX_TOKENS = 400;
const BODY_MAX_CHARS = 6000; // keep prompts tight — Haiku is cheap but bounded

export interface ExtractMentionsInput {
  /** Cleaned body text (sig-stripped + quote-stripped if available).
   *  The extractor truncates internally at BODY_MAX_CHARS. */
  body: string;
  /** Sender + recipient names — passed so the model knows NOT to
   *  emit them as "mentions" (they're the email's participants). */
  excludeNames: ReadonlyArray<string>;
}

export interface ExtractMentionsResult {
  /** Names extracted from the body — free-form strings, lower-cased
   *  for matching but NOT canonicalized. Caller does the fuzzy
   *  Contact match. */
  names: string[];
}

const SYSTEM_PROMPT = `You extract person names from email bodies. Read the body and return any specific people MENTIONED in the text.

RULES:
- Only return names that refer to specific people. NOT generic roles ("my advisor", "the dean").
- Skip the sender and recipient — they're already known.
- First-name-only mentions are fine ("Marc said..." → return "Marc").
- Don't extract nicknames if a full name is also in the email — return the full name.
- Public figures referenced (e.g., "Obama said") are people but probably NOT in the user's network — return them anyway, the matching step filters.
- If no people are mentioned, return an empty list.

Return ONLY valid JSON (no markdown, no preamble):

{ "names": ["Marc Beban", "Sarah Chen"] }`;

export async function extractMentions(
  input: ExtractMentionsInput,
): Promise<ExtractMentionsResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 30_000,
    maxRetries: 2,
  });

  const body = input.body.slice(0, BODY_MAX_CHARS);
  const exclude =
    input.excludeNames.length > 0
      ? `\n\nExclude these (sender/recipient): ${input.excludeNames.join(", ")}`
      : "";
  const userContent = `Email body:\n\n${body}${exclude}\n\nExtract names of people mentioned.`;

  try {
    const message = await anthropic.messages.create({
      model: MENTION_MODEL,
      max_tokens: MENTION_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });
    const text = message.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("");
    return parseMentionsResponse(text);
  } catch (err) {
    console.warn("[extract-mentions] Claude call failed:", err);
    return null;
  }
}

// ─── Pure helpers (testable) ───────────────────────────────

export function parseMentionsResponse(
  text: string,
): ExtractMentionsResult | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.names)) return { names: [] };
  const names = parsed.names
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .slice(0, 20);
  return { names };
}

/**
 * Match an extracted name string to a Contact ID using fuzzy logic.
 * Exported pure so we can unit-test the matching rules.
 *
 * Strategy:
 *   1. Exact case-insensitive name match — strongest
 *   2. Full-name token match (first+last tokens both appear in the
 *      contact's name in any order)
 *   3. First-name match — only counts when there's exactly ONE
 *      contact with that first name (else ambiguous; skip)
 *
 * Returns the matched contact's ID or null. The "single-name with
 * one match" rule avoids the "Marc could be 5 different people"
 * trap.
 */
export function matchNameToContact(
  name: string,
  contacts: ReadonlyArray<{ id: string; name: string }>,
): string | null {
  const lower = name.trim().toLowerCase();
  if (!lower) return null;

  // Pass 1: exact case-insensitive.
  const exact = contacts.find((c) => c.name.toLowerCase() === lower);
  if (exact) return exact.id;

  const nameTokens = lower.split(/\s+/).filter((t) => t.length >= 2);
  if (nameTokens.length === 0) return null;

  // Pass 2: all tokens present in contact's full name (covers nickname
  // variants like "Marc B." → "Marc Beban").
  if (nameTokens.length >= 2) {
    const allTokensMatch = contacts.filter((c) => {
      const ctn = c.name.toLowerCase();
      return nameTokens.every((tok) => ctn.includes(tok));
    });
    if (allTokensMatch.length === 1) return allTokensMatch[0].id;
  }

  // Pass 3: single-token (first name only) match. Only emit if
  // exactly one contact has that first name — otherwise ambiguous.
  if (nameTokens.length === 1) {
    const tok = nameTokens[0];
    const firstNameMatches = contacts.filter(
      (c) => c.name.toLowerCase().split(/\s+/)[0] === tok,
    );
    if (firstNameMatches.length === 1) return firstNameMatches[0].id;
  }

  return null;
}
