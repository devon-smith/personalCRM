/**
 * Life event extraction (M0.x.3).
 *
 * For an inbound email body, ask Claude Haiku whether it contains
 * a life event or career announcement FROM the sender. Used by the
 * feed-aggregator pipeline to surface ambient updates from Jennifer's
 * network without requiring her to read every email.
 *
 * The model is told to look for FIRST-person announcements only —
 * "I'm starting a new role at X" counts; "my friend joined X" does
 * not. This prevents the feed from filling with hearsay about people
 * Jennifer doesn't know.
 *
 * Fail-safe: any parse or API error returns { hasEvent: false }. A
 * missed signal is acceptable; a false positive in the feed is not.
 */
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";

/** Categories the extractor returns when an event is detected. */
export type LifeEventType =
  | "new_role"
  | "promotion"
  | "publication"
  | "award"
  | "company"
  | "move"
  | "family"
  | "milestone"
  | "other";

export interface ExtractInput {
  /** Inbound message body, ideally the full text (or a long snippet) */
  body: string;
  /** Subject line for emails (optional) */
  subject?: string | null;
  /** Sender display name for first-person disambiguation */
  fromName?: string | null;
}

export interface ExtractResult {
  hasEvent: boolean;
  /** Only meaningful when hasEvent === true */
  eventType?: LifeEventType;
  /** 1-line natural-language summary ("Becoming CEO at OpenEvidence") */
  summary?: string;
  /** Raw token usage for AIGenerationLog */
  tokensIn?: number;
  tokensOut?: number;
}

const SYSTEM_PROMPT = `You read an email and decide if the SENDER is announcing a personal life event or career milestone — something the recipient would want to know about that person.

YES, hasEvent=true examples:
- "I just had a baby" (family)
- "I'm starting at Anthropic as Head of Research next month" (new_role)
- "We just published in Science" (publication)
- "I'm moving to Tokyo for the year" (move)
- "I was named a MacArthur Fellow" (award)
- "I'm leaving the company to start something new" (new_role)
- "We had a son last week!" (family)

NO, hasEvent=false:
- A question or request (no announcement)
- An update about someone OTHER than the sender ("Did you see Sarah got promoted?")
- Routine project status, meeting scheduling, links, forwards
- Newsletter / marketing / automated mail
- Past events repeated ("As I mentioned, I moved to X last year")
- Asking for feedback ("Would you read this paper draft?")
- Thanks, FYIs, social pleasantries

Lean conservative. When uncertain, return hasEvent=false. A missed event is acceptable; a false positive clutters the feed.

Categories: new_role | promotion | publication | award | company | move | family | milestone | other

Return ONLY valid JSON:
{
  "hasEvent": false,
  "reason": "no first-person announcement"
}
OR
{
  "hasEvent": true,
  "eventType": "new_role",
  "summary": "Starting at Anthropic as Head of Research"
}`;

const VALID_TYPES: ReadonlyArray<LifeEventType> = [
  "new_role",
  "promotion",
  "publication",
  "award",
  "company",
  "move",
  "family",
  "milestone",
  "other",
];

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

function clip(text: string, limit = 4000): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "…";
}

export function buildUserPrompt(input: ExtractInput): string {
  const parts: string[] = [];
  if (input.fromName) parts.push(`Sender: ${input.fromName}`);
  if (input.subject) parts.push(`Subject: ${input.subject}`);
  parts.push(`Body:\n${clip(input.body)}`);
  return parts.join("\n\n");
}

export function parseExtractResponse(text: string): ExtractResult {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { hasEvent: false };
    const parsed = JSON.parse(jsonMatch[0]) as {
      hasEvent?: unknown;
      eventType?: unknown;
      summary?: unknown;
    };
    if (typeof parsed.hasEvent !== "boolean") return { hasEvent: false };
    if (!parsed.hasEvent) return { hasEvent: false };
    const eventType =
      typeof parsed.eventType === "string" &&
      (VALID_TYPES as readonly string[]).includes(parsed.eventType)
        ? (parsed.eventType as LifeEventType)
        : "other";
    const summary =
      typeof parsed.summary === "string" && parsed.summary.length > 0
        ? parsed.summary.trim()
        : "";
    // Require a summary — without one we have nothing useful to render
    // and a generic placeholder would clutter the feed.
    if (!summary) return { hasEvent: false };
    return { hasEvent: true, eventType, summary };
  } catch {
    return { hasEvent: false };
  }
}

export async function extractLifeEvent(
  input: ExtractInput,
): Promise<ExtractResult> {
  // Empty bodies short-circuit — no point spending tokens.
  if (!input.body.trim()) return { hasEvent: false };

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 250,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(input) }],
    });
    const block = response.content[0];
    const text = block && block.type === "text" ? block.text ?? "" : "";
    const parsed = parseExtractResponse(text);
    return {
      ...parsed,
      tokensIn: response.usage?.input_tokens,
      tokensOut: response.usage?.output_tokens,
    };
  } catch {
    return { hasEvent: false };
  }
}

export const LIFE_EVENT_MODEL = MODEL;
