import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { privateCacheHeaders } from "@/lib/http/cache";
import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@/generated/prisma/client";

const READ_CACHE_HEADERS = privateCacheHeaders(10 * 60, 30 * 60);
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_WINDOW_DAYS = 14;
const DORMANT_WINDOW_DAYS = 30;
const AI_CONTACT_LIMIT = 24;
const FALLBACK_CONTACT_LIMIT = 8;

const circleIntelligenceInFlight = new Map<string, Promise<CircleIntelligenceRouteResult>>();

const CIRCLE_INTELLIGENCE_CONTACT_SELECT = {
  id: true,
  name: true,
  company: true,
  role: true,
  tags: true,
  notes: true,
  lastInteraction: true,
  interactions: {
    orderBy: { occurredAt: "desc" },
    take: 3,
    select: {
      type: true,
      direction: true,
      subject: true,
      summary: true,
      occurredAt: true,
    },
  },
} satisfies Prisma.ContactSelect;

export interface CircleIntelligence {
  readonly narrative: string;
  readonly contactInsights: ReadonlyArray<{
    readonly contactId: string;
    readonly insight: string;
    readonly conversationStarter: string;
  }>;
}

type CircleIntelligenceContact = Prisma.ContactGetPayload<{
  select: typeof CIRCLE_INTELLIGENCE_CONTACT_SELECT;
}>;

interface CircleIntelligenceRouteResult {
  readonly body: CircleIntelligence | { readonly error: string };
  readonly status?: number;
  readonly cacheable?: boolean;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const inFlightKey = `${session.user.id}:${id}`;
    const existing = circleIntelligenceInFlight.get(inFlightKey);

    if (existing) {
      const result = await existing;
      return resultToResponse(result);
    }

    const pending = buildCircleIntelligence(session.user.id, id);
    circleIntelligenceInFlight.set(inFlightKey, pending);

    try {
      const result = await pending;
      return resultToResponse(result);
    } finally {
      if (circleIntelligenceInFlight.get(inFlightKey) === pending) {
        circleIntelligenceInFlight.delete(inFlightKey);
      }
    }
  } catch (error) {
    console.error("[GET /api/circles/[id]/intelligence]", error);
    return NextResponse.json(
      { error: "Failed to generate intelligence" },
      { status: 500 },
    );
  }
}

async function buildCircleIntelligence(
  userId: string,
  circleId: string,
): Promise<CircleIntelligenceRouteResult> {
  const circle = await prisma.circle.findFirst({
    where: { id: circleId, userId },
    select: { name: true, followUpDays: true },
  });

  if (!circle) {
    return { body: { error: "Circle not found" }, status: 404 };
  }

  const contactWhere = {
    userId,
    circles: { some: { circleId } },
  } satisfies Prisma.ContactWhereInput;

  const now = new Date();
  const activeCutoff = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * DAY_MS);
  const dormantCutoff = new Date(now.getTime() - DORMANT_WINDOW_DAYS * DAY_MS);

  const totalContacts = await prisma.contact.count({ where: contactWhere });

  if (totalContacts === 0) {
    return {
      body: {
        narrative: "This circle is empty. Add some contacts to get insights.",
        contactInsights: [],
      },
      cacheable: true,
    };
  }

  const [activeCount, dormantCount, contacts] = await Promise.all([
    prisma.contact.count({
      where: { ...contactWhere, lastInteraction: { gte: activeCutoff } },
    }),
    prisma.contact.count({
      where: {
        ...contactWhere,
        OR: [
          { lastInteraction: null },
          { lastInteraction: { lt: dormantCutoff } },
        ],
      },
    }),
    loadCircleIntelligenceContacts(contactWhere),
  ]);

  const fallback = generateTemplateFallback(
    circle.name,
    contacts,
    totalContacts,
    activeCount,
    dormantCount,
  );

  if (!process.env.ANTHROPIC_API_KEY) {
    return { body: fallback, cacheable: true };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const contactSummaries = buildContactSummaries(contacts);
  const omittedContacts = Math.max(totalContacts - contacts.length, 0);

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    system: `You are a thoughtful personal assistant helping someone stay connected with their network. You're generating insights about a group of contacts in their "${circle.name}" circle.

Be warm, specific, and observational — like a friend catching them up on a social group. Never use corporate language ("touch base", "circle back", "leverage"). Reference specific details from interactions when available.

Return ONLY valid JSON with no markdown:
{
  "narrative": "2-3 sentence warm summary of what's happening in this circle",
  "contactInsights": [
    {
      "contactId": "...",
      "insight": "1 sentence about what's notable about them right now",
      "conversationStarter": "A specific, natural thing to say to them"
    }
  ]
}

For conversation starters: be genuine and specific. Reference their work, something from a recent interaction, or a thoughtful question — not generic "how are you" or "let's catch up".`,
    messages: [
      {
        role: "user",
        content: [
          `Circle: ${circle.name} (${totalContacts} people, follow-up cadence: ${circle.followUpDays} days)`,
          `Active in last ${ACTIVE_WINDOW_DAYS} days: ${activeCount}`,
          `Dormant beyond ${DORMANT_WINDOW_DAYS} days or never contacted: ${dormantCount}`,
          omittedContacts > 0
            ? `People below are capped to the ${contacts.length} most recently active members; ${omittedContacts} less active members are omitted for prompt efficiency. Only return contactInsights for listed contactIds.`
            : "All circle members are listed below.",
          `People:\n${contactSummaries.join("\n\n")}`,
        ].join("\n"),
      },
    ],
  });

  const text = message.content[0]?.type === "text" ? message.content[0].text : "";
  const parsed = parseCircleIntelligence(text, new Set(contacts.map((c) => c.id)));

  return { body: parsed ?? fallback, cacheable: true };
}

function resultToResponse(result: CircleIntelligenceRouteResult) {
  return NextResponse.json(
    result.body,
    {
      status: result.status,
      headers: result.cacheable ? READ_CACHE_HEADERS : undefined,
    },
  );
}

async function loadCircleIntelligenceContacts(
  where: Prisma.ContactWhereInput,
): Promise<CircleIntelligenceContact[]> {
  const recentContacts = await prisma.contact.findMany({
    where: { ...where, lastInteraction: { not: null } },
    orderBy: [{ lastInteraction: "desc" }, { name: "asc" }],
    take: AI_CONTACT_LIMIT,
    select: CIRCLE_INTELLIGENCE_CONTACT_SELECT,
  });

  const remaining = AI_CONTACT_LIMIT - recentContacts.length;
  if (remaining <= 0) {
    return recentContacts;
  }

  const neverContacted = await prisma.contact.findMany({
    where: { ...where, lastInteraction: null },
    orderBy: { name: "asc" },
    take: remaining,
    select: CIRCLE_INTELLIGENCE_CONTACT_SELECT,
  });

  return [...recentContacts, ...neverContacted];
}

function buildContactSummaries(contacts: readonly CircleIntelligenceContact[]) {
  return contacts.map((contact) => {
    const interactions = contact.interactions
      .map((interaction) => {
        const date = interaction.occurredAt.toLocaleDateString();
        return `${date}: ${interaction.type} (${interaction.direction})${interaction.subject ? ` — ${interaction.subject}` : ""}${interaction.summary ? ` — ${interaction.summary.slice(0, 100)}` : ""}`;
      })
      .join("\n    ");

    return `- ${contact.name} [contactId: ${contact.id}]${contact.role ? `, ${contact.role}` : ""}${contact.company ? ` at ${contact.company}` : ""}
    Tags: ${contact.tags.length > 0 ? contact.tags.join(", ") : "none"}
    Notes: ${contact.notes?.slice(0, 150) ?? "none"}
    Last interaction: ${contact.lastInteraction?.toLocaleDateString() ?? "never"}
    Recent activity:\n    ${interactions || "none"}`;
  });
}

function parseCircleIntelligence(
  text: string,
  allowedContactIds: ReadonlySet<string>,
): CircleIntelligence | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as Partial<CircleIntelligence>;
    if (typeof parsed.narrative !== "string") return null;

    const contactInsights = Array.isArray(parsed.contactInsights)
      ? parsed.contactInsights
        .filter((insight) =>
          insight &&
          typeof insight.contactId === "string" &&
          allowedContactIds.has(insight.contactId) &&
          typeof insight.insight === "string" &&
          typeof insight.conversationStarter === "string")
        .slice(0, FALLBACK_CONTACT_LIMIT)
      : [];

    return {
      narrative: parsed.narrative,
      contactInsights,
    };
  } catch {
    return null;
  }
}

function generateTemplateFallback(
  circleName: string,
  contacts: readonly CircleIntelligenceContact[],
  totalContacts: number,
  activeCount: number,
  dormantCount: number,
): CircleIntelligence {
  const now = new Date();

  const narrative = activeCount > 0
    ? `Your ${circleName} circle has ${totalContacts} people. You've been in touch with ${activeCount} of them recently${dormantCount > 0 ? `, and ${dormantCount} could use a check-in` : ""}.`
    : `Your ${circleName} circle has ${totalContacts} people. It's been a while since you've connected with most of them.`;

  const contactInsights = contacts.slice(0, FALLBACK_CONTACT_LIMIT).map((c) => {
    const daysSince = c.lastInteraction
      ? Math.floor((now.getTime() - c.lastInteraction.getTime()) / 86400000)
      : null;
    const firstName = c.name.split(" ")[0];

    return {
      contactId: c.id,
      insight: daysSince !== null
        ? daysSince < 7 ? "Recently active" : `Last heard from ${daysSince} days ago`
        : "No interactions yet",
      conversationStarter: c.company
        ? `Hey ${firstName}, how are things going at ${c.company}?`
        : `Hey ${firstName}, would love to catch up soon.`,
    };
  });

  return { narrative, contactInsights };
}
