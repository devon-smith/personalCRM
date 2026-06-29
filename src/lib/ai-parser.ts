import Anthropic from "@anthropic-ai/sdk";

export const INTERACTION_PARSE_MODEL = "claude-haiku-4-5-20251001";
export const MAX_INTERACTION_PARSE_INPUT_CHARS = 5_000;
const MAX_INTERACTION_PARSE_PROMPT_CHARS = 2_000;
const INTERACTION_TYPES = ["EMAIL", "MESSAGE", "MEETING", "CALL", "NOTE"] as const;
const INTERACTION_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface ParsedInteraction {
  type: "EMAIL" | "MESSAGE" | "MEETING" | "CALL" | "NOTE";
  direction: "INBOUND" | "OUTBOUND";
  subject: string;
  summary: string;
  occurredAt: string | null;
}

export async function parseInteractionText(
  rawText: string,
  contactName: string
): Promise<ParsedInteraction> {
  const inputText = normalizeInteractionParseInput(rawText);
  const message = await anthropic.messages.create({
    model: INTERACTION_PARSE_MODEL,
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `Parse this text into a structured interaction log for a CRM.
The contact's name is: ${contactName}

Text to parse:
---
${inputText.slice(0, MAX_INTERACTION_PARSE_PROMPT_CHARS)}
---

Determine:
1. type: EMAIL, MESSAGE, MEETING, CALL, or NOTE
2. direction: INBOUND (from the contact) or OUTBOUND (to the contact)
3. subject: A short subject line (max 60 chars)
4. summary: A 1-2 sentence summary of the key points
5. occurredAt: ISO date string if a date is mentioned, otherwise null

Return as JSON:
{
  "type": "EMAIL",
  "direction": "INBOUND",
  "subject": "...",
  "summary": "...",
  "occurredAt": "2024-01-15T10:00:00Z"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return coerceParsedInteraction(parsed, inputText);
    }
  } catch {
    // fallback
  }

  return {
    type: "NOTE",
    direction: "INBOUND",
    subject: "Parsed interaction",
    summary: inputText.slice(0, 200),
    occurredAt: null,
  };
}

export function normalizeInteractionParseInput(rawText: string): string {
  return rawText.trim().slice(0, MAX_INTERACTION_PARSE_INPUT_CHARS);
}

export function coerceParsedInteraction(
  value: unknown,
  fallbackText: string,
): ParsedInteraction {
  const parsed = isRecord(value) ? value : {};
  const type = INTERACTION_TYPES.includes(parsed.type as ParsedInteraction["type"])
    ? (parsed.type as ParsedInteraction["type"])
    : "NOTE";
  const direction = INTERACTION_DIRECTIONS.includes(
    parsed.direction as ParsedInteraction["direction"],
  )
    ? (parsed.direction as ParsedInteraction["direction"])
    : "INBOUND";
  return {
    type,
    direction,
    subject:
      typeof parsed.subject === "string" && parsed.subject.trim()
        ? parsed.subject.trim().slice(0, 60)
        : "Parsed interaction",
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : fallbackText.slice(0, 200),
    occurredAt:
      typeof parsed.occurredAt === "string" && parsed.occurredAt.trim()
        ? parsed.occurredAt.trim()
        : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
