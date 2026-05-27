/**
 * Needs-response classifier (M0.x.2).
 *
 * Runs Claude Haiku on the latest inbound message of an InboxItem
 * to decide whether it actually needs a personal reply. Filters
 * FYIs, thanks, social pleasantries out of the default inbox view.
 *
 * Replaces the older per-Interaction /api/inbox-items/classify
 * route. That ran on demand from the browser; this fires
 * automatically from the worker every time onInboundInteraction
 * creates or touches an InboxItem.
 *
 * Fail-open: any error → { needsResponse: true } so a real reply
 * never gets hidden because of a transient API hiccup.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getUserProfile } from "@/lib/user-profile";

const MODEL = "claude-haiku-4-5-20251001";

/**
 * Categories the classifier returns. The first two ("question",
 * "request") mark items as needing a reply; the rest don't. UI
 * shows the category alongside the short reason so the user can
 * see the model's framing without expanding the evidence chevron.
 */
export type ResponseCategory =
  | "question"
  | "request"
  | "fyi"
  | "thanks"
  | "acknowledgment"
  | "social"
  | "newsletter"
  | "autoresponder";

export interface ClassifyInput {
  /** Most recent inbound message body — what we classify */
  messageBody: string;
  /** Optional subject line for emails */
  subject?: string | null;
  /** Sender's relationship type ("former_student", "peer_faculty", …) */
  relationshipType?: string | null;
  /** Up to 2 prior thread messages, oldest first, for short context */
  threadContext?: Array<{ role: "inbound" | "outbound"; text: string }>;
  /** Display name used to address the user in prompts (cached) */
  userFirstName?: string;
}

export interface ClassifyResult {
  needsResponse: boolean;
  confidence: number;
  reason: string;
  category: ResponseCategory;
  /** Raw token usage for AIGenerationLog */
  tokensIn?: number;
  tokensOut?: number;
}

const SYSTEM_PROMPT_TEMPLATE = (name: string) =>
  `You are classifying whether an email or message needs a personal response from ${name}, a Stanford professor.

Consider: does the sender ask a question, request action, or share information that warrants engagement? FYI emails, simple thanks, acknowledgments, and social pleasantries usually DON'T need a response.

Categories that DO need a response (needsResponse=true):
- "question" — sender asks a direct question
- "request" — sender asks for something specific (an action, a meeting, a referral)

Categories that DON'T need a response (needsResponse=false):
- "fyi" — informational forward, no engagement expected
- "thanks" — gratitude with no question
- "acknowledgment" — confirming receipt, short "got it"
- "social" — casual pleasantry, "hope you're well", birthday wishes
- "newsletter" — mass mailing that slipped through the filter
- "autoresponder" — out-of-office, calendar bot, automated notification

Be conservative: when in doubt, lean toward needsResponse=true with lower confidence rather than skipping something important.

"reason" rules — STRICT:
- Maximum 6 words. Title-case or sentence-case, no terminal period.
- Phrase, not a sentence. Verb-first when natural.
- Good: "Asks a direct question", "Brief thanks", "FYI forward",
  "Requests meeting time", "Newsletter", "Out-of-office reply",
  "Acknowledges receipt".
- Bad: "Agreement and acknowledgment without new requests or questions",
  "This is a thank-you message that doesn't require a reply",
  "The sender is just confirming they received your email."
- If you can't say it in 6 words, the category itself is the reason.

Return ONLY valid JSON in this exact shape:
{
  "needsResponse": true,
  "confidence": 0.85,
  "reason": "Asks a direct question",
  "category": "question"
}`;

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

/** Strip Re:/Fwd: prefixes so the model sees the actual topic */
function cleanSubject(subject: string | null | undefined): string {
  if (!subject) return "";
  return subject.replace(/^(re|fwd?):\s*/gi, "").trim();
}

/** Truncate to a reasonable size for Haiku; longer bodies waste tokens */
function clip(text: string, limit = 4000): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "…";
}

export function buildUserPrompt(input: ClassifyInput): string {
  const parts: string[] = [];
  if (input.relationshipType) {
    parts.push(`Sender relationship: ${input.relationshipType}`);
  }
  const subject = cleanSubject(input.subject);
  if (subject) {
    parts.push(`Subject: ${subject}`);
  }
  if (input.threadContext && input.threadContext.length > 0) {
    const lines = input.threadContext.map((m) => {
      const speaker = m.role === "outbound" ? "Me" : "Them";
      return `${speaker}: ${clip(m.text, 400)}`;
    });
    parts.push(`Prior thread context:\n${lines.join("\n")}`);
  }
  parts.push(`Message to classify:\n${clip(input.messageBody)}`);
  return parts.join("\n\n");
}

const VALID_CATEGORIES: ReadonlyArray<ResponseCategory> = [
  "question",
  "request",
  "fyi",
  "thanks",
  "acknowledgment",
  "social",
  "newsletter",
  "autoresponder",
];

/** Cap classifier reasons at 6 words + 60 chars, strip a terminal
 *  period. Defensive — the system prompt asks for short phrases but
 *  Sonnet sometimes drifts into full sentences on long inbound mail. */
export function trimToShortPhrase(raw: string): string {
  const cleaned = raw.trim().replace(/[.\s]+$/, "");
  const words = cleaned.split(/\s+/);
  const capped = words.slice(0, 6).join(" ");
  return capped.length > 60 ? capped.slice(0, 57) + "…" : capped;
}

export function parseClassifyResponse(text: string): ClassifyResult {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("no JSON object found");
    const parsed = JSON.parse(jsonMatch[0]) as {
      needsResponse?: unknown;
      confidence?: unknown;
      reason?: unknown;
      category?: unknown;
    };
    if (typeof parsed.needsResponse !== "boolean") {
      throw new Error("missing needsResponse");
    }
    const category =
      typeof parsed.category === "string" &&
      (VALID_CATEGORIES as readonly string[]).includes(parsed.category)
        ? (parsed.category as ResponseCategory)
        : parsed.needsResponse
          ? "question"
          : "fyi";
    return {
      needsResponse: parsed.needsResponse,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.5,
      reason:
        typeof parsed.reason === "string" && parsed.reason.length > 0
          ? trimToShortPhrase(parsed.reason)
          : parsed.needsResponse
            ? "Looks like it needs a reply"
            : "Doesn't need a reply",
      category,
    };
  } catch {
    // Fail-open
    return {
      needsResponse: true,
      confidence: 0.0,
      reason: "Classifier parse error — defaulting to needs reply",
      category: "question",
    };
  }
}

/**
 * Classify a single inbound message. Always returns a result (fail-
 * open on API errors). Callers should pass the latest inbound message
 * body, not the whole thread.
 */
export async function classifyResponse(
  input: ClassifyInput,
): Promise<ClassifyResult> {
  const name =
    input.userFirstName?.trim() ||
    getUserProfile().firstName ||
    "the user";
  const system = SYSTEM_PROMPT_TEMPLATE(name);
  const userMessage = buildUserPrompt(input);

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system,
      messages: [{ role: "user", content: userMessage }],
    });
    const block = response.content[0];
    const text = block && block.type === "text" ? block.text ?? "" : "";
    const parsed = parseClassifyResponse(text);
    return {
      ...parsed,
      tokensIn: response.usage?.input_tokens,
      tokensOut: response.usage?.output_tokens,
    };
  } catch {
    return {
      needsResponse: true,
      confidence: 0.0,
      reason: "Classifier API error — defaulting to needs reply",
      category: "question",
    };
  }
}

export const CLASSIFIER_MODEL = MODEL;
