import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import type { DraftTone, DraftContext } from "@/lib/draft-composer-context";
import { getUserProfile } from "@/lib/user-profile";
import { logAIGeneration } from "@/lib/ai-generation-log";
import { getVoiceExamples, type VoiceExampleResult } from "@/lib/voice/few-shot-retrieval";
import {
  buildVoiceBlock,
  buildClosingGuidance,
  hasVoiceContext,
} from "@/lib/voice/draft-prompt";
import type { LearnedProfile } from "@/lib/voice/profile";
import { classifyRecipient, type RelationshipType } from "@/lib/voice/relationship-classifier";

const DRAFT_MODEL = "claude-sonnet-4-20250514";

/** Cap retrieved examples — more than 4 dilutes the signal + bloats tokens. */
const VOICE_EXAMPLE_COUNT = 4;

export interface GenerateDraftParams {
  readonly contactId: string;
  readonly userId: string;
  readonly tone: DraftTone;
  readonly context: DraftContext;
  readonly contextDetail?: string;
  readonly threadSubject?: string;
  readonly threadSnippet?: string;
  /** Optional manual override of the inferred relationship type
   *  (M6.4). When set, the few-shot retrieval skips the classifier
   *  and pulls examples from this bucket directly. */
  readonly relationshipTypeOverride?: RelationshipType;
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
      email: true,
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
      id: true,
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
    select: { id: true, content: true, mood: true, createdAt: true },
  });

  // Get ContactMemory (M8.3) — synthesized conversational context.
  // Null when the memory-synthesis worker hasn't run yet for this contact.
  const memory = await prisma.contactMemory.findUnique({
    where: { contactId: params.contactId },
    select: {
      discussedTopics: true,
      theyMentioned: true,
      openThreads: true,
      personalContext: true,
      recurringThemes: true,
    },
  });

  // Get changelog entries (life updates)
  const lifeUpdates = await prisma.contactChangelog.findMany({
    where: { contactId: params.contactId, status: { in: ["PENDING", "SEEN"] } },
    orderBy: { detectedAt: "desc" },
    take: 2,
    select: { id: true, type: true, field: true, oldValue: true, newValue: true },
  });

  const inputRefs = [
    `contact:${params.contactId}`,
    ...interactions.map((i) => `interaction:${i.id}`),
    ...journalEntries.map((j) => `journal:${j.id}`),
    ...lifeUpdates.map((u) => `changelog:${u.id}`),
    ...(memory ? [`memory:${params.contactId}`] : []),
  ];

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

  // M8.3: synthesized memory becomes a structured "What I know"
  // block. Only render sections that have content so the prompt
  // doesn't pad with empty headers.
  const memorySummary = memory ? buildMemorySummary(memory) : "";

  // Try AI generation first, fall back to templates
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      // Best-effort voice context — fails gracefully if VOYAGE_API_KEY
      // isn't set, no VoiceProfile exists, or retrieval errors out.
      // The non-voice prompt path still runs in that case.
      const voiceContext = await tryFetchVoiceContext({
        userId: params.userId,
        recipientEmail: contact.email,
        draftIntent: buildDraftIntent({
          tone: params.tone,
          context: params.context,
          contextDetail: params.contextDetail,
          threadSubject: params.threadSubject,
          threadSnippet: params.threadSnippet,
        }),
        relationshipTypeOverride: params.relationshipTypeOverride,
      });
      return await generateWithAI({
        ...params,
        contact,
        firstName,
        circleNames,
        interactionsSummary,
        journalSummary,
        lifeUpdatesSummary,
        memorySummary,
        inputRefs: voiceContext
          ? [
              ...inputRefs,
              ...voiceContext.examples.map((e) => `voiceExample:${e.emailMessageId}`),
            ]
          : inputRefs,
        voiceContext,
      });
    } catch (err) {
      console.error("[draft-generator] AI generation failed, using templates:", err);
      await logAIGeneration({
        userId: params.userId,
        feature: "draft",
        model: DRAFT_MODEL,
        inputRefs,
        error: err instanceof Error ? err.message : String(err),
      });
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

interface VoiceContext {
  examples: VoiceExampleResult[];
  learnedProfile: LearnedProfile | null;
  relationshipType: RelationshipType;
}

async function generateWithAI(params: GenerateDraftParams & {
  contact: { name: string; company: string | null; role: string | null; tier: string; notes: string | null };
  firstName: string;
  circleNames: string[];
  interactionsSummary: string;
  journalSummary: string;
  lifeUpdatesSummary: string;
  memorySummary: string;
  inputRefs: string[];
  voiceContext: VoiceContext | null;
}): Promise<DraftResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const startedAt = Date.now();

  const profile = getUserProfile();
  const baseInstructions = `You are drafting a message for ${profile.fullName}, ${profile.bio}. ${profile.fullName}'s style: ${profile.style}. Draft should sound like a real person texting a friend or emailing a colleague — not a CRM.

Generate two variants:
1. Quick: 2-3 sentences, gets the point across fast
2. Detailed: 4-5 sentences, adds specific context/warmth

Also generate a subject line if this is an email (not for texts).

IMPORTANT:
- If replying to an email, acknowledge the delay if it's been more than 3 days. Don't be overly apologetic, just briefly.
- Reference specific things from past interactions when possible.
- If the contact is at a specific company, you can reference it naturally.
- Use the "What I know" memory section when present: reference open threads (questions they asked, things you promised), personal context (their family, location, life events), and recurring themes they care about — naturally, not as a checklist. Never invent details that aren't in the memory.
- Never use: ${profile.bannedPhrases.map((p) => `'${p}'`).join(", ")}.
- ${profile.firstName} signs emails '${profile.emailSignoff}' for professional${profile.casualSignoff ? `, '${profile.emailSignoff}' for casual` : ", nothing for casual texts"}.
- For texts/casual: no greeting needed, just dive in.
- For emails: brief greeting ('Hey ${params.firstName},' not 'Dear ${params.firstName},')

Return ONLY valid JSON with no markdown:
{"quick": "...", "detailed": "...", "subjectLine": "..." or null}`;

  // Voice-aware path: when we have a profile + retrieved examples for
  // this recipient's relationship type, inject them as a cached
  // system-prompt segment. The voice block is stable per (user ×
  // relationship type), so drafting multiple emails to the same kind
  // of recipient re-uses the cached prefix on subsequent calls.
  const voiceBlock = params.voiceContext
    ? buildVoiceBlock({
        learnedProfile: params.voiceContext.learnedProfile,
        examples: params.voiceContext.examples,
        relationshipType: params.voiceContext.relationshipType,
      })
    : null;
  const closingGuidance = params.voiceContext
    ? buildClosingGuidance({
        learnedProfile: params.voiceContext.learnedProfile,
        examples: params.voiceContext.examples,
        relationshipType: params.voiceContext.relationshipType,
      })
    : "";

  // Anthropic SDK accepts `system` as either a string or an array of
  // text blocks. We use the array form to attach cache_control to the
  // voice block — the base instructions are short enough that caching
  // them isn't worth the write markup cost.
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    { type: "text", text: baseInstructions },
  ];
  if (voiceBlock) {
    systemBlocks.push({
      type: "text",
      text:
        voiceBlock + (closingGuidance ? `\n\n${closingGuidance}` : ""),
      cache_control: { type: "ephemeral" },
    });
  }

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
    // M8.3: ContactMemory injected as structured "What I know" text.
    // Empty string when the synthesis worker hasn't profiled this
    // contact yet — model just gets less context, no schema impact.
    whatIKnowAboutThem: params.memorySummary || "None",
  }, null, 2);

  const message = await anthropic.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 800,
    system: systemBlocks,
    messages: [{ role: "user", content: userContent }],
  });

  await logAIGeneration({
    userId: params.userId,
    feature: "draft",
    model: DRAFT_MODEL,
    inputRefs: params.inputRefs,
    tokensIn: message.usage?.input_tokens ?? null,
    tokensOut: message.usage?.output_tokens ?? null,
    cacheHit:
      (message.usage?.cache_read_input_tokens ?? 0) > 0 ? true : null,
    latencyMs: Date.now() - startedAt,
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

/**
 * Build a short free-text description of the draft intent for Voyage
 * to embed and use as the retrieval query. We blend tone + context +
 * any caller-supplied detail / thread context so the query matches
 * past emails of similar shape.
 */
function buildDraftIntent(params: {
  tone: DraftTone;
  context: DraftContext;
  contextDetail?: string;
  threadSubject?: string;
  threadSnippet?: string;
}): string {
  const parts: string[] = [
    `Tone: ${TONE_LABELS[params.tone]}`,
    `Context: ${CONTEXT_LABELS[params.context]}`,
  ];
  if (params.contextDetail) parts.push(`Detail: ${params.contextDetail}`);
  if (params.threadSubject) parts.push(`Subject: ${params.threadSubject}`);
  if (params.threadSnippet) parts.push(`Their message: ${params.threadSnippet}`);
  return parts.join(". ");
}

/**
 * Pull the user's learned voice profile + a handful of similar past
 * outbound emails. Returns null if any prerequisite is missing — the
 * draft generator falls back to the non-voice prompt path in that case
 * rather than failing the whole generation.
 */
async function tryFetchVoiceContext(args: {
  userId: string;
  recipientEmail: string | null;
  draftIntent: string;
  relationshipTypeOverride?: RelationshipType;
}): Promise<VoiceContext | null> {
  if (!args.recipientEmail) return null;
  if (!process.env.VOYAGE_API_KEY) return null;

  try {
    const relationshipType =
      args.relationshipTypeOverride ??
      (await classifyRecipient({
        prisma,
        userId: args.userId,
        recipientEmail: args.recipientEmail,
      }));
    const [examples, profile] = await Promise.all([
      getVoiceExamples({
        prisma,
        userId: args.userId,
        recipientEmail: args.recipientEmail,
        draftIntent: args.draftIntent,
        k: VOICE_EXAMPLE_COUNT,
        relationshipTypeOverride: args.relationshipTypeOverride,
      }),
      prisma.voiceProfile.findUnique({
        where: { userId: args.userId },
        select: { learned: true },
      }),
    ]);
    const learnedProfile =
      (profile?.learned as unknown as LearnedProfile | null) ?? null;
    const ctx: VoiceContext = { examples, learnedProfile, relationshipType };
    // If there's truly nothing to inject, return null so the caller
    // takes the cheaper non-voice path.
    if (
      !hasVoiceContext({
        learnedProfile,
        examples,
        relationshipType,
      })
    ) {
      return null;
    }
    return ctx;
  } catch (err) {
    console.warn("[draft-generator] voice context unavailable:", err);
    return null;
  }
}

/**
 * Format ContactMemory into the "What I know" prompt block (M8.3).
 * Pure function — passed only the JSON shape that comes back from
 * Prisma, no DB access. Returns an empty string when every section
 * is empty so the caller can short-circuit to "None" in the prompt.
 *
 * Exported for unit testing.
 */
export function buildMemorySummary(memory: {
  discussedTopics: unknown;
  theyMentioned: unknown;
  openThreads: unknown;
  personalContext: unknown;
  recurringThemes: string[];
}): string {
  const sections: string[] = [];

  const personal = memory.personalContext as Record<string, unknown> | null;
  if (personal && typeof personal === "object") {
    const entries = Object.entries(personal).filter(
      ([, v]) => typeof v === "string" && v.length > 0,
    );
    if (entries.length > 0) {
      sections.push(
        "Personal context: " +
          entries.map(([k, v]) => `${k}: ${v as string}`).join("; "),
      );
    }
  }

  if (memory.recurringThemes.length > 0) {
    sections.push(`Recurring themes: ${memory.recurringThemes.join(", ")}`);
  }

  const openThreads = Array.isArray(memory.openThreads)
    ? (memory.openThreads as Array<Record<string, unknown>>).filter(
        (t) => t.status !== "resolved",
      )
    : [];
  if (openThreads.length > 0) {
    sections.push(
      "Open threads:\n" +
        openThreads
          .slice(0, 5)
          .map((t) => {
            const who = t.raisedBy === "user" ? "You" : "They";
            const date = t.raisedAt ? ` (${t.raisedAt})` : "";
            return `  - ${who}${date}: ${t.subject}`;
          })
          .join("\n"),
    );
  }

  const mentioned = Array.isArray(memory.theyMentioned)
    ? (memory.theyMentioned as Array<Record<string, unknown>>)
    : [];
  if (mentioned.length > 0) {
    sections.push(
      "They've mentioned about themselves:\n" +
        mentioned
          .slice(0, 5)
          .map(
            (m) =>
              `  - ${m.subject}${m.context ? ` (${m.context})` : ""}${m.mentionedAt ? ` [${m.mentionedAt}]` : ""}`,
          )
          .join("\n"),
    );
  }

  return sections.join("\n\n");
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
  const profile = getUserProfile();
  const { tone, context, firstName, company, threadSubject, daysSinceLastInteraction } = params;
  const isCasual = tone === "casual" || tone === "checking_in";
  const companyRef = company ? ` at ${company}` : "";
  const signoff = `\n\n${profile.emailSignoff}`;
  const maybeSignoff = isCasual ? "" : signoff;
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
      detailed: `Hey ${firstName}, it's been ${timeSince} and I wanted to check in. How's everything${companyRef}? I'd love to hear what you've been working on. Let me know if you're free for a quick coffee or call sometime soon.${signoff}`,
      subjectLine: `Catching up`,
    },
    "professional_catching_up": {
      quick: `Hi ${firstName}, hope things are going well${companyRef}. Wanted to touch base — any time for a quick chat this week?`,
      detailed: `Hi ${firstName}, hope things are going well${companyRef}. It's been ${timeSince} since we connected and I wanted to check in. I'd love to hear how things are going on your end. Would you have time for a quick call this week or next?${signoff}`,
      subjectLine: `Quick check-in`,
    },
    "casual_reply_email": {
      quick: `Hey ${firstName}, sorry for the late reply! ${threadSubject ? `Re the ${threadSubject.replace(/^Re:\s*/i, "")} — ` : ""}sounds good, let's do it.`,
      detailed: `Hey ${firstName}, apologies for sitting on this — been heads down with school. ${threadSubject ? `Regarding "${threadSubject.replace(/^Re:\s*/i, "")}" — ` : ""}I think that works well. Let me know if you want to hop on a quick call to hash out the details. Free later this week?`,
      subjectLine: threadSubject ? `Re: ${threadSubject.replace(/^Re:\s*/i, "")}` : null,
    },
    "professional_reply_email": {
      quick: `Hi ${firstName}, thanks for the email. I'll review and get back to you shortly.`,
      detailed: `Hi ${firstName}, appreciate you sending this over. ${threadSubject ? `Re: "${threadSubject.replace(/^Re:\s*/i, "")}" — ` : ""}I'll take a closer look and follow up with thoughts by end of week.${signoff}`,
      subjectLine: threadSubject ? `Re: ${threadSubject.replace(/^Re:\s*/i, "")}` : null,
    },
    "congratulatory_congratulate": {
      quick: `Hey ${firstName}! Just saw the news — congrats, so well deserved! Let's celebrate sometime.`,
      detailed: `Hey ${firstName}, just heard the news${params.contextDetail ? ` about ${params.contextDetail}` : ""}! Really happy for you — you've been working hard and it shows. We should grab a drink to celebrate when you're free.${maybeSignoff}`,
      subjectLine: isCasual ? null : `Congrats!`,
    },
    "professional_ask": {
      quick: `Hi ${firstName}, hope you're doing well${companyRef}. ${params.contextDetail ? params.contextDetail : "I had a quick ask — would you have a few minutes to chat this week?"}`,
      detailed: `Hi ${firstName}, hope things are going well${companyRef}. ${params.contextDetail ? params.contextDetail : "I'm looking to connect with someone and thought you might be the right person to ask."} Would you be open to a quick chat? Happy to work around your schedule.${signoff}`,
      subjectLine: `Quick question`,
    },
    "warm_follow_up": {
      quick: `Hey ${firstName}, just following up${params.contextDetail ? ` on ${params.contextDetail}` : ""}. Any updates on your end?`,
      detailed: `Hey ${firstName}, wanted to follow up${params.contextDetail ? ` on ${params.contextDetail}` : " from our last conversation"}. Would love to hear if there's any movement on your end. Let me know if there's anything I can do to help.${signoff}`,
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
    detailed: `Hey ${firstName}, hope you're doing well${companyRef}. I wanted to reach out and connect — it's been a while since we last talked. Would love to catch up if you have some time.${signoff}`,
    subjectLine: `Hey ${firstName}`,
  };
}
