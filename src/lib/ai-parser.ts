import Anthropic from "@anthropic-ai/sdk";

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
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: `Parse this text into a structured interaction log for a CRM.
The contact's name is: ${contactName}

Text to parse:
---
${rawText.slice(0, 2000)}
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
      return {
        type: parsed.type ?? "NOTE",
        direction: parsed.direction ?? "INBOUND",
        subject: parsed.subject ?? "Parsed interaction",
        summary: parsed.summary ?? rawText.slice(0, 200),
        occurredAt: parsed.occurredAt ?? null,
      };
    }
  } catch {
    // fallback
  }

  return {
    type: "NOTE",
    direction: "INBOUND",
    subject: "Parsed interaction",
    summary: rawText.slice(0, 200),
    occurredAt: null,
  };
}
