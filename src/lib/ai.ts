import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface ContactContext {
  name: string;
  company?: string | null;
  role?: string | null;
  tier: string;
  notes?: string | null;
}

interface InteractionContext {
  type: string;
  direction: string;
  subject?: string | null;
  summary?: string | null;
  occurredAt: string | Date;
}

export async function generateFollowUp(
  contact: ContactContext,
  lastInteractions: InteractionContext[]
): Promise<{ casual: string; professional: string }> {
  const interactionsSummary = lastInteractions
    .map(
      (i) =>
        `- ${i.type} (${i.direction}): ${i.subject ?? "No subject"} — ${i.summary ?? "No summary"}`
    )
    .join("\n");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `You are a CRM assistant helping draft follow-up messages.

Contact: ${contact.name}
${contact.company ? `Company: ${contact.company}` : ""}
${contact.role ? `Role: ${contact.role}` : ""}
Tier: ${contact.tier}
${contact.notes ? `Notes: ${contact.notes}` : ""}

Recent interactions:
${interactionsSummary || "No recent interactions"}

Write two short follow-up messages for this contact:
1. CASUAL: Friendly, warm tone. 2-3 sentences max.
2. PROFESSIONAL: Business-appropriate, polite. 2-3 sentences max.

Return as JSON: { "casual": "...", "professional": "..." }`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";
  try {
    // Extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // fallback
  }
  return { casual: text, professional: text };
}

export async function suggestTags(
  contact: ContactContext,
  interactions: InteractionContext[]
): Promise<string[]> {
  const interactionsSummary = interactions
    .slice(0, 5)
    .map((i) => `${i.type}: ${i.summary ?? i.subject ?? ""}`)
    .join("; ");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `Based on this contact info, suggest 3-5 relevant tags (lowercase, hyphenated).

Name: ${contact.name}
Company: ${contact.company ?? "N/A"}
Role: ${contact.role ?? "N/A"}
Notes: ${contact.notes ?? "N/A"}
Interactions: ${interactionsSummary || "None"}

Return as JSON array: ["tag-1", "tag-2", ...]`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // fallback
  }
  return [];
}

export async function summarizeInteractions(
  contactName: string,
  interactions: InteractionContext[]
): Promise<string> {
  const interactionsSummary = interactions
    .map(
      (i) =>
        `- ${new Date(i.occurredAt).toLocaleDateString()}: ${i.type} (${i.direction}) — ${i.subject ?? ""} ${i.summary ?? ""}`
    )
    .join("\n");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `Summarize the relationship with ${contactName} in 2-3 sentences based on these interactions:

${interactionsSummary || "No interactions recorded."}

Be concise and focus on the nature and quality of the relationship.`,
      },
    ],
  });

  return message.content[0].type === "text"
    ? message.content[0].text
    : "Unable to generate summary.";
}
