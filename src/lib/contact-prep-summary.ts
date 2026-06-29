interface RecentInteractionForPrep {
  type: string;
  direction: string;
  subject: string | null;
  summary: string | null;
  occurredAt: Date | string;
}

interface ProfileForPrep {
  expertiseAreas: string[];
  relationshipStage: string | null;
}

interface MemoryForPrep {
  recurringThemes: string[];
  openThreads: unknown;
  theyMentioned: unknown;
}

export interface ContactPrepSummaryInput {
  name: string;
  company: string | null;
  role: string | null;
  profile: ProfileForPrep | null;
  memory: MemoryForPrep | null;
  recentInteractions: RecentInteractionForPrep[];
}

export function buildContactPrepSummary(input: ContactPrepSummaryInput): string {
  const sentences: string[] = [];
  const roleLine = [input.role, input.company].filter(Boolean).join(" at ");
  const themes = input.memory?.recurringThemes.slice(0, 3) ?? [];
  const expertise = input.profile?.expertiseAreas.slice(0, 2) ?? [];
  const openThreads = normalizeOpenThreads(input.memory?.openThreads).slice(0, 2);
  const personalMentions = normalizePersonalMentions(input.memory?.theyMentioned).slice(0, 2);
  const latest = input.recentInteractions[0] ?? null;

  const introParts = [
    roleLine ? `${input.name} is ${roleLine}` : input.name,
    input.profile?.relationshipStage
      ? `relationship stage: ${input.profile.relationshipStage}`
      : null,
  ].filter(Boolean);
  sentences.push(`${introParts.join("; ")}.`);

  const contextParts = [
    themes.length > 0 ? `Recurring themes: ${themes.join(", ")}` : null,
    expertise.length > 0 ? `expertise: ${expertise.join(", ")}` : null,
  ].filter(Boolean);
  if (contextParts.length > 0) {
    sentences.push(contextParts.join("; ") + ".");
  }

  if (openThreads.length > 0) {
    sentences.push(
      `Open loops to acknowledge: ${openThreads
        .map((thread) => thread.subject)
        .filter(Boolean)
        .join("; ")}.`,
    );
  } else if (personalMentions.length > 0) {
    sentences.push(
      `Useful personal context: ${personalMentions
        .map((mention) => mention.subject)
        .filter(Boolean)
        .join("; ")}.`,
    );
  } else if (latest) {
    const latestSummary = latest.summary || latest.subject || latest.type;
    sentences.push(
      `Most recent touchpoint was ${formatInteractionDate(latest.occurredAt)}: ${latestSummary}.`,
    );
  } else {
    sentences.push("No recent interactions are recorded yet.");
  }

  return sentences.slice(0, 3).join(" ");
}

function normalizeOpenThreads(value: unknown): Array<{ subject: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .filter((item) => item.status !== "resolved")
    .map((item) => ({
      subject: typeof item.subject === "string" ? item.subject : "",
    }))
    .filter((item) => item.subject.length > 0);
}

function normalizePersonalMentions(value: unknown): Array<{ subject: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      subject: typeof item.subject === "string" ? item.subject : "",
    }))
    .filter((item) => item.subject.length > 0);
}

function formatInteractionDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
