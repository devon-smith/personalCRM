// ─── Priority scoring for inbox items ───────────────────────

export type Priority = "high" | "medium" | "low";

export interface PriorityResult {
  readonly score: number; // 0-100
  readonly priority: Priority;
  readonly reason: string;
}

interface PriorityInput {
  readonly tier: string;
  readonly channel: string;
  readonly triggerAt: Date;
  readonly classification?: string | null;
  readonly messageCount: number;
  readonly isGroupChat: boolean;
}

// ─── Scoring components ─────────────────────────────────────

const TIER_SCORES: Record<string, number> = {
  INNER_CIRCLE: 30,
  PROFESSIONAL: 15,
  ACQUAINTANCE: 5,
};

const CHANNEL_SCORES: Record<string, number> = {
  whatsapp: 15,
  text: 15,
  email: 10,
  linkedin: 8,
};

const CLASSIFICATION_SCORES: Record<string, number> = {
  action_required: 20,
  invitation: 15,
  request: 15,
  question: 10,
  emotional: 10,
};

function recencyScore(triggerAt: Date): { score: number; label: string } {
  const hoursAgo = (Date.now() - triggerAt.getTime()) / (1000 * 60 * 60);
  if (hoursAgo < 24) return { score: 25, label: "today" };
  if (hoursAgo < 48) return { score: 20, label: "yesterday" };
  if (hoursAgo < 72) return { score: 15, label: "2-3 days" };
  if (hoursAgo < 168) return { score: 10, label: "this week" };
  return { score: 5, label: "older" };
}

// ─── Main scoring function ──────────────────────────────────

export function computePriority(item: PriorityInput): PriorityResult {
  const factors: Array<{ name: string; value: number }> = [];

  // Tier
  const tierVal = TIER_SCORES[item.tier] ?? 10;
  factors.push({ name: tierLabel(item.tier), value: tierVal });

  // Recency
  const recency = recencyScore(item.triggerAt);
  factors.push({ name: `Sent ${recency.label}`, value: recency.score });

  // Channel
  const channelVal = CHANNEL_SCORES[item.channel] ?? 5;
  factors.push({ name: channelLabel(item.channel), value: channelVal });

  // Classification
  const classVal = item.classification
    ? (CLASSIFICATION_SCORES[item.classification] ?? 0)
    : 0;
  if (classVal > 0) {
    factors.push({ name: classificationLabel(item.classification!), value: classVal });
  }

  // Repeat messages bonus
  const repeatBonus = item.messageCount > 3 ? 10 : 0;
  if (repeatBonus > 0) {
    factors.push({ name: "Multiple messages", value: repeatBonus });
  }

  // Group chat penalty
  const groupPenalty = item.isGroupChat ? -5 : 0;
  if (groupPenalty < 0) {
    factors.push({ name: "Group chat", value: groupPenalty });
  }

  const rawScore = factors.reduce((sum, f) => sum + f.value, 0);
  const score = Math.max(0, Math.min(100, rawScore));

  const priority: Priority =
    score >= 60 ? "high" : score >= 30 ? "medium" : "low";

  // Top 2 positive contributing factors as reason
  const topFactors = factors
    .filter((f) => f.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((f) => f.name);
  const reason = topFactors.join(" · ") || "Low activity";

  return { score, priority, reason };
}

// ─── Label helpers ──────────────────────────────────────────

function tierLabel(tier: string): string {
  switch (tier) {
    case "INNER_CIRCLE": return "Inner circle";
    case "PROFESSIONAL": return "Professional";
    case "ACQUAINTANCE": return "Acquaintance";
    default: return "Contact";
  }
}

function channelLabel(channel: string): string {
  switch (channel) {
    case "whatsapp": return "WhatsApp";
    case "text": return "iMessage";
    case "email": return "Email";
    case "linkedin": return "LinkedIn";
    default: return channel;
  }
}

function classificationLabel(classification: string): string {
  switch (classification) {
    case "action_required": return "Action needed";
    case "invitation": return "Invitation";
    case "request": return "Request";
    case "question": return "Question";
    case "emotional": return "Personal";
    default: return classification;
  }
}
