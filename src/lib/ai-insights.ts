import Anthropic from "@anthropic-ai/sdk";

const hasApiKey =
  !!process.env.ANTHROPIC_API_KEY &&
  process.env.ANTHROPIC_API_KEY !== "your-anthropic-api-key";

const anthropic = hasApiKey
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

interface ContactForInsight {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  tier: string;
  tags: string[];
  notes: string | null;
  lastInteraction: Date | null;
  interactions: Array<{
    type: string;
    direction: string;
    subject: string | null;
    summary: string | null;
    occurredAt: Date;
  }>;
}

export interface HealthResult {
  healthScore: number;
  healthLabel: "thriving" | "stable" | "fading" | "dormant";
  summary: string;
  actions: string[];
}

export interface DigestSection {
  highlights: string[];
  needsAttention: Array<{ name: string; reason: string }>;
  suggestedActions: string[];
  stats: {
    totalInteractions: number;
    contactsReached: number;
    newContacts: number;
  };
}

export interface IntroductionSuggestion {
  contact1: { id: string; name: string };
  contact2: { id: string; name: string };
  reason: string;
  icebreaker: string;
}

function extractJson<T>(text: string): T | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {
    // try array
  }
  try {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
  } catch {
    // fallback
  }
  return null;
}

export async function computeRelationshipHealth(
  contact: ContactForInsight
): Promise<HealthResult> {
  const now = new Date();
  const daysSinceLast = contact.lastInteraction
    ? Math.floor(
        (now.getTime() - new Date(contact.lastInteraction).getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : 999;

  // Fallback: heuristic-based score (used when no API key or as fallback)
  const heuristicScore =
    daysSinceLast > 90
      ? 15
      : daysSinceLast > 60
        ? 30
        : daysSinceLast > 30
          ? 50
          : daysSinceLast > 14
            ? 70
            : 85;
  const heuristicLabel =
    heuristicScore >= 70
      ? "thriving"
      : heuristicScore >= 50
        ? "stable"
        : heuristicScore >= 30
          ? "fading"
          : "dormant";
  const heuristicResult: HealthResult = {
    healthScore: heuristicScore,
    healthLabel: heuristicLabel,
    summary: daysSinceLast === 999
      ? "No interactions recorded yet."
      : `Last interaction was ${daysSinceLast} days ago.`,
    actions: ["Reach out soon to maintain this relationship."],
  };

  if (!anthropic) return heuristicResult;

  const recentInteractions = contact.interactions.slice(0, 10);
  const interactionsSummary = recentInteractions
    .map(
      (i) =>
        `- ${new Date(i.occurredAt).toLocaleDateString()}: ${i.type} (${i.direction}) — ${i.summary ?? i.subject ?? "No details"}`
    )
    .join("\n");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: `Analyze this relationship's health for a personal CRM.

Contact: ${contact.name}
Company: ${contact.company ?? "N/A"}
Role: ${contact.role ?? "N/A"}
Tier: ${contact.tier}
Tags: ${contact.tags.join(", ") || "None"}
Days since last interaction: ${daysSinceLast}
Total interactions: ${contact.interactions.length}

Recent interactions:
${interactionsSummary || "No interactions recorded"}

Rate this relationship's health from 0-100 and classify as one of: thriving, stable, fading, dormant.
Provide a 1-sentence summary and 1-3 specific recommended actions.

Return as JSON:
{
  "healthScore": 85,
  "healthLabel": "thriving",
  "summary": "...",
  "actions": ["action 1", "action 2"]
}`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";
  const result = extractJson<HealthResult>(text);

  if (result && typeof result.healthScore === "number") {
    return {
      healthScore: Math.max(0, Math.min(100, result.healthScore)),
      healthLabel: result.healthLabel ?? "stable",
      summary: result.summary ?? "Unable to analyze.",
      actions: result.actions ?? [],
    };
  }

  return heuristicResult;
}

export async function generateWeeklyDigest(
  contacts: Array<{
    id: string;
    name: string;
    company: string | null;
    tier: string;
    lastInteraction: Date | null;
  }>,
  recentInteractions: Array<{
    contactName: string;
    type: string;
    direction: string;
    summary: string | null;
    occurredAt: Date;
  }>,
  overdueCount: number,
  newContactsCount: number
): Promise<DigestSection> {
  if (!anthropic) {
    return {
      highlights: ["AI insights require an Anthropic API key. Using heuristic data."],
      needsAttention: contacts
        .filter((c) => {
          if (!c.lastInteraction) return true;
          const days = Math.floor(
            (Date.now() - new Date(c.lastInteraction).getTime()) / (1000 * 60 * 60 * 24),
          );
          return days > 30;
        })
        .slice(0, 5)
        .map((c) => ({ name: c.name, reason: "No recent interaction" })),
      suggestedActions: ["Set up your Anthropic API key for AI-powered insights."],
      stats: {
        totalInteractions: recentInteractions.length,
        contactsReached: new Set(recentInteractions.map((i) => i.contactName)).size,
        newContacts: newContactsCount,
      },
    };
  }

  const interactionLines = recentInteractions
    .slice(0, 20)
    .map(
      (i) =>
        `- ${i.contactName}: ${i.type} (${i.direction}) — ${i.summary ?? "No summary"}`
    )
    .join("\n");

  const fadingContacts = contacts
    .filter((c) => {
      if (!c.lastInteraction) return true;
      const days = Math.floor(
        (Date.now() - new Date(c.lastInteraction).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      return (
        (c.tier === "INNER_CIRCLE" && days > 14) ||
        (c.tier === "PROFESSIONAL" && days > 30) ||
        (c.tier === "ACQUAINTANCE" && days > 90)
      );
    })
    .slice(0, 10)
    .map((c) => `${c.name} (${c.tier}, ${c.company ?? "no company"})`)
    .join("\n");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 600,
    messages: [
      {
        role: "user",
        content: `Generate a weekly CRM digest.

Network size: ${contacts.length} contacts
Overdue follow-ups: ${overdueCount}
New contacts this week: ${newContactsCount}

This week's interactions:
${interactionLines || "None this week"}

Contacts needing attention:
${fadingContacts || "None — you're all caught up!"}

Create a structured digest with:
1. highlights: 2-3 key observations about this week's networking
2. needsAttention: top 3-5 contacts needing follow-up with reason
3. suggestedActions: 2-4 specific actions to take this week

Return as JSON:
{
  "highlights": ["...", "..."],
  "needsAttention": [{"name": "...", "reason": "..."}],
  "suggestedActions": ["...", "..."]
}`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";
  const result = extractJson<{
    highlights: string[];
    needsAttention: Array<{ name: string; reason: string }>;
    suggestedActions: string[];
  }>(text);

  return {
    highlights: result?.highlights ?? ["No digest available."],
    needsAttention: result?.needsAttention ?? [],
    suggestedActions: result?.suggestedActions ?? [],
    stats: {
      totalInteractions: recentInteractions.length,
      contactsReached: new Set(recentInteractions.map((i) => i.contactName))
        .size,
      newContacts: newContactsCount,
    },
  };
}

export async function suggestIntroductions(
  contacts: Array<{
    id: string;
    name: string;
    company: string | null;
    role: string | null;
    tier: string;
    tags: string[];
  }>
): Promise<IntroductionSuggestion[]> {
  if (contacts.length < 2 || !anthropic) return [];

  const contactList = contacts
    .slice(0, 30) // limit context size
    .map(
      (c) =>
        `- ${c.name} | ${c.company ?? "N/A"} | ${c.role ?? "N/A"} | ${c.tier} | tags: ${c.tags.join(", ") || "none"}`
    )
    .join("\n");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `Analyze these contacts and suggest 2-3 pairs who might benefit from being introduced to each other.

Contacts:
${contactList}

For each pair, explain why they should meet and provide an icebreaker message.

Return as JSON array:
[{
  "contact1Name": "...",
  "contact2Name": "...",
  "reason": "...",
  "icebreaker": "..."
}]`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";
  const raw = extractJson<
    Array<{
      contact1Name: string;
      contact2Name: string;
      reason: string;
      icebreaker: string;
    }>
  >(text);

  if (!Array.isArray(raw)) return [];

  // Map names back to IDs
  const nameToContact = new Map(contacts.map((c) => [c.name.toLowerCase(), c]));

  return raw
    .map((suggestion) => {
      const c1 = nameToContact.get(suggestion.contact1Name?.toLowerCase());
      const c2 = nameToContact.get(suggestion.contact2Name?.toLowerCase());
      if (!c1 || !c2) return null;
      return {
        contact1: { id: c1.id, name: c1.name },
        contact2: { id: c2.id, name: c2.name },
        reason: suggestion.reason,
        icebreaker: suggestion.icebreaker,
      };
    })
    .filter((s): s is IntroductionSuggestion => s !== null);
}
