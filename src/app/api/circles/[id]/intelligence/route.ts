import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";

export interface CircleIntelligence {
  readonly narrative: string;
  readonly contactInsights: ReadonlyArray<{
    readonly contactId: string;
    readonly insight: string;
    readonly conversationStarter: string;
  }>;
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

    // Fetch circle with contacts and their recent interactions
    const circle = await prisma.circle.findFirst({
      where: { id, userId: session.user.id },
      select: { name: true, color: true, followUpDays: true },
    });

    if (!circle) {
      return NextResponse.json({ error: "Circle not found" }, { status: 404 });
    }

    const memberships = await prisma.contactCircle.findMany({
      where: { circleId: id },
      select: {
        contact: {
          select: {
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
          },
        },
      },
    });

    const contacts = memberships.map((m) => m.contact);

    if (contacts.length === 0) {
      return NextResponse.json({
        narrative: "This circle is empty. Add some contacts to get insights.",
        contactInsights: [],
      });
    }

    // Build context for AI
    const contactSummaries = contacts.map((c) => {
      const interactions = c.interactions
        .map((i) => {
          const date = i.occurredAt.toLocaleDateString();
          return `${date}: ${i.type} (${i.direction})${i.subject ? ` — ${i.subject}` : ""}${i.summary ? ` — ${i.summary.slice(0, 100)}` : ""}`;
        })
        .join("\n    ");

      return `- ${c.name}${c.role ? `, ${c.role}` : ""}${c.company ? ` at ${c.company}` : ""}
    Tags: ${c.tags.length > 0 ? c.tags.join(", ") : "none"}
    Notes: ${c.notes?.slice(0, 150) ?? "none"}
    Last interaction: ${c.lastInteraction?.toLocaleDateString() ?? "never"}
    Recent activity:\n    ${interactions || "none"}`;
    });

    // If no API key, return template-based response
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(generateTemplateFallback(circle.name, contacts));
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
          content: `Circle: ${circle.name} (${contacts.length} people, follow-up cadence: ${circle.followUpDays} days)\n\nPeople:\n${contactSummaries.join("\n\n")}`,
        },
      ],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as CircleIntelligence;
        return NextResponse.json(parsed);
      }
    } catch {
      // Parse failure — fall through to template
    }

    return NextResponse.json(generateTemplateFallback(circle.name, contacts));
  } catch (error) {
    console.error("[GET /api/circles/[id]/intelligence]", error);
    return NextResponse.json(
      { error: "Failed to generate intelligence" },
      { status: 500 },
    );
  }
}

function generateTemplateFallback(
  circleName: string,
  contacts: Array<{
    id: string;
    name: string;
    company: string | null;
    role: string | null;
    lastInteraction: Date | null;
  }>,
): CircleIntelligence {
  const now = new Date();
  const active = contacts.filter(
    (c) => c.lastInteraction && now.getTime() - c.lastInteraction.getTime() < 14 * 86400000,
  );
  const dormant = contacts.filter(
    (c) => !c.lastInteraction || now.getTime() - c.lastInteraction.getTime() > 30 * 86400000,
  );

  const narrative = active.length > 0
    ? `Your ${circleName} circle has ${contacts.length} people. You've been in touch with ${active.length} of them recently${dormant.length > 0 ? `, and ${dormant.length} could use a check-in` : ""}.`
    : `Your ${circleName} circle has ${contacts.length} people. It's been a while since you've connected with most of them.`;

  const contactInsights = contacts.slice(0, 8).map((c) => {
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
