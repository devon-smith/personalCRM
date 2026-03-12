import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import type { DraftTone, DraftContext } from "@/lib/draft-composer-context";

export interface GenerateDraftParams {
  readonly contactId: string;
  readonly userId: string;
  readonly tone: DraftTone;
  readonly context: DraftContext;
  readonly contextDetail?: string;
  readonly threadSubject?: string;
  readonly threadSnippet?: string;
}

export interface DraftResult {
  readonly quick: string;
  readonly detailed: string;
  readonly subjectLine: string | null;
}

const TONE_LABELS: Record<DraftTone, string> = {
  casual: "Casual — like texting a friend",
  warm: "Warm — friendly but not too informal",
  professional: "Professional — business-appropriate",
  congratulatory: "Congratulatory — celebratory and genuine",
  checking_in: "Checking in — brief, low-pressure",
};

const CONTEXT_LABELS: Record<DraftContext, string> = {
  reply_email: "Replying to their email",
  catching_up: "Just catching up / staying in touch",
  congratulate: "Congratulating them on something",
  ask: "Asking for something (intro, advice, meeting, etc.)",
  follow_up: "Following up on a specific topic",
};

export async function generateDraft(params: GenerateDraftParams): Promise<DraftResult> {
  // Gather contact context
  const contact = await prisma.contact.findUnique({
    where: { id: params.contactId },
    select: {
      name: true,
      company: true,
      role: true,
      tier: true,
      notes: true,
      linkedinUrl: true,
      circles: {
        select: { circle: { select: { name: true } } },
      },
    },
  });

  if (!contact) throw new Error("Contact not found");

  // Get last 5 interactions
  const interactions = await prisma.interaction.findMany({
    where: { contactId: params.contactId, userId: params.userId },
    orderBy: { occurredAt: "desc" },
    take: 5,
    select: {
      type: true,
      direction: true,
      subject: true,
      summary: true,
      occurredAt: true,
    },
  });

  // Get journal entries (last 2)
  const journalEntries = await prisma.journalEntry.findMany({
    where: { contactId: params.contactId, userId: params.userId },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { content: true, mood: true, createdAt: true },
  });

  // Get changelog entries (life updates)
  const lifeUpdates = await prisma.contactChangelog.findMany({
    where: { contactId: params.contactId, status: { in: ["PENDING", "SEEN"] } },
    orderBy: { detectedAt: "desc" },
    take: 2,
    select: { type: true, field: true, oldValue: true, newValue: true },
  });

  const circleNames = contact.circles.map((c) => c.circle.name);
  const firstName = contact.name.split(" ")[0];

  const interactionsSummary = interactions
    .map((i) => {
      const date = new Date(i.occurredAt).toLocaleDateString();
      return `- ${date}: ${i.type} (${i.direction})${i.subject ? ` — "${i.subject}"` : ""}${i.summary ? ` — ${i.summary}` : ""}`;
    })
    .join("\n");

  const journalSummary = journalEntries
    .map((j) => `- ${new Date(j.createdAt).toLocaleDateString()} (${j.mood}): ${j.content.slice(0, 150)}`)
    .join("\n");

  const lifeUpdatesSummary = lifeUpdates
    .map((u) => `- ${u.type}: ${u.field} changed from "${u.oldValue}" to "${u.newValue}"`)
    .join("\n");

  // Try AI generation first, fall back to templates
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await generateWithAI({
        ...params,
        contact,
        firstName,
        circleNames,
        interactionsSummary,
        journalSummary,
        lifeUpdatesSummary,
      });
    } catch (err) {
      console.error("[draft-generator] AI generation failed, using templates:", err);
    }
  }

  return generateFromTemplate({
    ...params,
    firstName,
    company: contact.company,
    circleNames,
    daysSinceLastInteraction: interactions[0]
      ? Math.floor((Date.now() - new Date(interactions[0].occurredAt).getTime()) / 86400000)
      : null,
  });
}

async function generateWithAI(params: GenerateDraftParams & {
  contact: { name: string; company: string | null; role: string | null; tier: string; notes: string | null };
  firstName: string;
  circleNames: string[];
  interactionsSummary: string;
  journalSummary: string;
  lifeUpdatesSummary: string;
}): Promise<DraftResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = `You are drafting a message for Devon Smith, a Stanford MS CS student. Devon's style: casual but thoughtful, uses first names, doesn't use formal openers like 'I hope this finds you well.' Draft should sound like a real person texting a friend or emailing a colleague — not a CRM.

Generate two variants:
1. Quick: 2-3 sentences, gets the point across fast
2. Detailed: 4-5 sentences, adds specific context/warmth

Also generate a subject line if this is an email (not for texts).

IMPORTANT:
- If replying to an email, acknowledge the delay if it's been more than 3 days. Don't be overly apologetic, just briefly.
- Reference specific things from past interactions when possible.
- If the contact is at a specific company, you can reference it naturally.
- Never use: 'Hope this finds you well', 'I wanted to reach out', 'Per my last email', 'Circle back', 'Touch base', 'Hope you're doing well'.
- Devon signs emails 'Best, Devon' for professional, nothing for casual texts.
- For texts/casual: no greeting needed, just dive in.
- For emails: brief greeting ('Hey ${params.firstName},' not 'Dear ${params.firstName},')

Return ONLY valid JSON with no markdown:
{"quick": "...", "detailed": "...", "subjectLine": "..." or null}`;

  const userContent = JSON.stringify({
    contact: {
      name: params.contact.name,
      company: params.contact.company,
      role: params.contact.role,
      tier: params.contact.tier,
      circles: params.circleNames,
    },
    tone: TONE_LABELS[params.tone],
    context: CONTEXT_LABELS[params.context],
    contextDetail: params.contextDetail || undefined,
    threadSubject: params.threadSubject || undefined,
    threadSnippet: params.threadSnippet || undefined,
    recentInteractions: params.interactionsSummary || "None",
    journalNotes: params.journalSummary || "None",
    lifeUpdates: params.lifeUpdatesSummary || "None",
  }, null, 2);

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        quick: parsed.quick ?? "",
        detailed: parsed.detailed ?? "",
        subjectLine: parsed.subjectLine ?? null,
      };
    }
  } catch {
    // Parse failure — fall through to template
  }

  return { quick: text, detailed: text, subjectLine: null };
}

function generateFromTemplate(params: {
  tone: DraftTone;
  context: DraftContext;
  contextDetail?: string;
  firstName: string;
  company: string | null;
  circleNames: string[];
  threadSubject?: string;
  daysSinceLastInteraction: number | null;
}): DraftResult {
  const { tone, context, firstName, company, threadSubject, daysSinceLastInteraction } = params;
  const isCasual = tone === "casual" || tone === "checking_in";
  const companyRef = company ? ` at ${company}` : "";
  const timeSince = daysSinceLastInteraction
    ? daysSinceLastInteraction > 30 ? "a while" : `${daysSinceLastInteraction} days`
    : "a while";

  const templates: Record<string, { quick: string; detailed: string; subjectLine: string | null }> = {
    "casual_catching_up": {
      quick: `Hey ${firstName}! Been a while — how's everything going${companyRef}? Would love to catch up soon.`,
      detailed: `Hey ${firstName}! It's been ${timeSince} since we last talked — time flies. How's everything${companyRef}? I've been heads down with school but would love to grab coffee or hop on a call sometime. Free this week?`,
      subjectLine: null,
    },
    "warm_catching_up": {
      quick: `Hey ${firstName}, been thinking about you — how are things going${companyRef}? Would love to hear what you've been up to.`,
      detailed: `Hey ${firstName}, it's been ${timeSince} and I wanted to check in. How's everything${companyRef}? I'd love to hear what you've been working on. Let me know if you're free for a quick coffee or call sometime soon.\n\nBest,\nDevon`,
      subjectLine: `Catching up`,
    },
    "professional_catching_up": {
      quick: `Hi ${firstName}, hope things are going well${companyRef}. Wanted to touch base — any time for a quick chat this week?`,
      detailed: `Hi ${firstName}, hope things are going well${companyRef}. It's been ${timeSince} since we connected and I wanted to check in. I'd love to hear how things are going on your end. Would you have time for a quick call this week or next?\n\nBest,\nDevon`,
      subjectLine: `Quick check-in`,
    },
    "casual_reply_email": {
      quick: `Hey ${firstName}, sorry for the late reply! ${threadSubject ? `Re the ${threadSubject.replace(/^Re:\s*/i, "")} — ` : ""}sounds good, let's do it.`,
      detailed: `Hey ${firstName}, apologies for sitting on this — been heads down with school. ${threadSubject ? `Regarding "${threadSubject.replace(/^Re:\s*/i, "")}" — ` : ""}I think that works well. Let me know if you want to hop on a quick call to hash out the details. Free later this week?`,
      subjectLine: threadSubject ? `Re: ${threadSubject.replace(/^Re:\s*/i, "")}` : null,
    },
    "professional_reply_email": {
      quick: `Hi ${firstName}, thanks for the email. I'll review and get back to you shortly.`,
      detailed: `Hi ${firstName}, appreciate you sending this over. ${threadSubject ? `Re: "${threadSubject.replace(/^Re:\s*/i, "")}" — ` : ""}I'll take a closer look and follow up with thoughts by end of week.\n\nBest,\nDevon`,
      subjectLine: threadSubject ? `Re: ${threadSubject.replace(/^Re:\s*/i, "")}` : null,
    },
    "congratulatory_congratulate": {
      quick: `Hey ${firstName}! Just saw the news — congrats, so well deserved! Let's celebrate sometime.`,
      detailed: `Hey ${firstName}, just heard the news${params.contextDetail ? ` about ${params.contextDetail}` : ""}! Really happy for you — you've been working hard and it shows. We should grab a drink to celebrate when you're free.${isCasual ? "" : "\n\nBest,\nDevon"}`,
      subjectLine: isCasual ? null : `Congrats!`,
    },
    "professional_ask": {
      quick: `Hi ${firstName}, hope you're doing well${companyRef}. ${params.contextDetail ? params.contextDetail : "I had a quick ask — would you have a few minutes to chat this week?"}`,
      detailed: `Hi ${firstName}, hope things are going well${companyRef}. ${params.contextDetail ? params.contextDetail : "I'm looking to connect with someone and thought you might be the right person to ask."} Would you be open to a quick chat? Happy to work around your schedule.\n\nBest,\nDevon`,
      subjectLine: `Quick question`,
    },
    "warm_follow_up": {
      quick: `Hey ${firstName}, just following up${params.contextDetail ? ` on ${params.contextDetail}` : ""}. Any updates on your end?`,
      detailed: `Hey ${firstName}, wanted to follow up${params.contextDetail ? ` on ${params.contextDetail}` : " from our last conversation"}. Would love to hear if there's any movement on your end. Let me know if there's anything I can do to help.\n\nBest,\nDevon`,
      subjectLine: params.contextDetail ? `Following up — ${params.contextDetail}` : `Following up`,
    },
  };

  // Try exact match first, then fallback chain
  const key = `${tone}_${context}`;
  if (templates[key]) return templates[key];

  // Fallback: try tone category
  const toneCategory = isCasual ? "casual" : tone === "congratulatory" ? "congratulatory" : "professional";
  const fallbackKey = `${toneCategory}_${context}`;
  if (templates[fallbackKey]) return templates[fallbackKey];

  // Fallback: try warm variant
  const warmKey = `warm_${context}`;
  if (templates[warmKey]) return templates[warmKey];

  // Ultimate fallback
  return {
    quick: `Hey ${firstName}, wanted to reach out. Let me know if you have a moment to chat.`,
    detailed: `Hey ${firstName}, hope you're doing well${companyRef}. I wanted to reach out and connect — it's been a while since we last talked. Would love to catch up if you have some time.\n\nBest,\nDevon`,
    subjectLine: `Hey ${firstName}`,
  };
}
