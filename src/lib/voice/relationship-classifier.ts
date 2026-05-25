/**
 * Relationship-type classifier for voice corpus indexing (M6.1).
 *
 * Cascade (cheapest signal first):
 *   1. Recipient's circle membership → mapped to relationship type
 *   2. Recipient's ContactTier → coarse mapping
 *   3. Claude classifier (cached in AIGenerationLog) as last resort
 *
 * The Claude path is bounded by the cost-control instinct: if the
 * recipient isn't in the CRM at all (no Contact row), we skip the
 * Claude call entirely and label "unknown" — we don't burn tokens on
 * one-off recipients.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@/generated/prisma/client";

export type RelationshipType =
  | "former_student"
  | "peer_faculty"
  | "industry_exec"
  | "media"
  | "family"
  | "board"
  | "casual"
  | "unknown";

export const RELATIONSHIP_TYPES: ReadonlyArray<RelationshipType> = [
  "former_student",
  "peer_faculty",
  "industry_exec",
  "media",
  "family",
  "board",
  "casual",
  "unknown",
];

// ─── Circle-name → relationship type heuristics ────────────

/**
 * Map a circle name (lowercased) to a relationship type. Best-effort —
 * if the circle name doesn't match any known pattern, returns null and
 * we fall through to ContactTier.
 *
 * Patterns are intentionally permissive (substring matches) since
 * Jennifer names her own circles ("MSx 2019", "Inner Circle", etc.).
 */
function circleNameToType(circleName: string): RelationshipType | null {
  const n = circleName.toLowerCase();
  if (/student|alum|msx|gsb|mba|cohort/.test(n)) return "former_student";
  if (/faculty|colleague|professor|academic/.test(n)) return "peer_faculty";
  if (/ceo|founder|exec|industry|startup/.test(n)) return "industry_exec";
  if (/press|media|journalist|reporter/.test(n)) return "media";
  if (/family|fam\b|relative|parent|sibling/.test(n)) return "family";
  if (/board|director|trustee|advisor/.test(n)) return "board";
  return null;
}

/**
 * Map ContactTier to a coarse default. Only used when no circle gives
 * us a better signal. INNER_CIRCLE → casual (it's the catch-all for
 * "close people who don't fit any specific bucket"); PROFESSIONAL →
 * peer_faculty as a reasonable default for an academic's network.
 */
function tierToType(tier: string): RelationshipType {
  switch (tier) {
    case "INNER_CIRCLE":
      return "casual";
    case "PROFESSIONAL":
      return "peer_faculty";
    case "ACQUAINTANCE":
    default:
      return "unknown";
  }
}

// ─── Claude classifier (last-resort) ───────────────────────

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

interface ClaudeClassifierInput {
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  recentSubjects: string[];
}

async function classifyViaClaude(input: ClaudeClassifierInput): Promise<RelationshipType> {
  if (!anthropic) return "unknown";

  const prompt = `Classify this person's relationship to Jennifer (a Stanford GSB professor) into ONE category:
- former_student: a current or former student of Jennifer's
- peer_faculty: another academic / professor / researcher
- industry_exec: business leader, founder, CEO, executive
- media: journalist, reporter, podcast host, press contact
- family: family member or relative
- board: board director, trustee, advisor
- casual: friend / acquaintance that doesn't fit the above
- unknown: insufficient signal

Person:
- Name: ${input.name}
- Email: ${input.email ?? "(unknown)"}
- Company: ${input.company ?? "(unknown)"}
- Role: ${input.role ?? "(unknown)"}
- Recent email subjects with Jennifer: ${input.recentSubjects.slice(0, 5).join(" | ") || "(none)"}

Respond with just the category name, nothing else.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 20,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content
      .map((c) => (c.type === "text" ? c.text.trim().toLowerCase() : ""))
      .join("");
    if (RELATIONSHIP_TYPES.includes(text as RelationshipType)) {
      return text as RelationshipType;
    }
  } catch {
    // Fall through to unknown.
  }
  return "unknown";
}

// ─── Top-level classifier ──────────────────────────────────

export interface ClassifyArgs {
  prisma: PrismaClient;
  userId: string;
  recipientEmail: string;
}

/**
 * Resolve a recipient email to a relationship type via the cascade.
 * Caches results across calls — if the same recipient appears in many
 * sent emails (Jennifer corresponds with them often), we only hit the
 * Claude fallback once per indexing run.
 *
 * The cache lives in-memory per process. The worker reuses it across
 * the batch; on cold start we re-classify, which is fine.
 */
const classifyCache = new Map<string, RelationshipType>();

export function clearRelationshipClassifierCache(): void {
  classifyCache.clear();
}

export async function classifyRecipient(args: ClassifyArgs): Promise<RelationshipType> {
  const { prisma, userId, recipientEmail } = args;
  const cacheKey = `${userId}:${recipientEmail.toLowerCase()}`;
  const cached = classifyCache.get(cacheKey);
  if (cached) return cached;

  const result = await classifyUncached(prisma, userId, recipientEmail);
  classifyCache.set(cacheKey, result);
  return result;
}

async function classifyUncached(
  prisma: PrismaClient,
  userId: string,
  recipientEmail: string,
): Promise<RelationshipType> {
  // Find the contact + their circles.
  const contact = await prisma.contact.findFirst({
    where: {
      userId,
      OR: [
        { email: { equals: recipientEmail, mode: "insensitive" } },
        { additionalEmails: { has: recipientEmail.toLowerCase() } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      company: true,
      role: true,
      tier: true,
      circles: { select: { circle: { select: { name: true } } } },
    },
  });

  if (!contact) return "unknown";

  // Layer 1: circle membership.
  for (const cc of contact.circles) {
    const type = circleNameToType(cc.circle.name);
    if (type) return type;
  }

  // Layer 2: tier mapping. If tier gives something better than
  // "unknown", take it and skip the Claude call.
  const tierGuess = tierToType(contact.tier);
  if (tierGuess !== "unknown") return tierGuess;

  // Layer 3: Claude. Pull a few recent email subjects as additional signal.
  const recentEmails = await prisma.emailMessage.findMany({
    where: { userId, contactId: contact.id },
    select: { subject: true },
    orderBy: { occurredAt: "desc" },
    take: 5,
  });
  return classifyViaClaude({
    name: contact.name,
    email: contact.email,
    company: contact.company,
    role: contact.role,
    recentSubjects: recentEmails.map((e) => e.subject ?? "").filter(Boolean),
  });
}
