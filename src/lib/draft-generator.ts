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
  type VoiceReferenceForPrompt,
} from "@/lib/voice/draft-prompt";
import type { LearnedProfile } from "@/lib/voice/profile";
import { classifyRecipient, type RelationshipType } from "@/lib/voice/relationship-classifier";
import { getVoiceReferences } from "@/lib/voice/references/retrieval";
import { embedBatch, formatVectorLiteral } from "@/lib/search/embeddings";
import {
  loadReplyContext,
  buildReplyPromptBlock,
  type ReplyContext,
} from "@/lib/draft-reply-context";
import {
  buildPersonFactsPromptBlock,
  loadPersonFactsForPrompt,
} from "@/lib/person-facts";
import { getAnthropicSonnetModel } from "@/lib/anthropic-models";
import { contactHasEmail, displayNameFromEmail } from "@/lib/contact-email";

const DRAFT_MODEL = getAnthropicSonnetModel();

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
  /** InboxItem.threadKey ("gmail:<id>" for Gmail). When present
   *  alongside context="reply_email", we fetch the actual inbound
   *  message + thread history and inject them into the prompt
   *  instead of relying on the snippet alone. (M0.x.4) */
  readonly threadKey?: string;
  /** Pre-loaded reply context — callers that already have it can
   *  pass it in to skip the DB + Gmail fetch. (M0.x.4) */
  readonly replyContext?: ReplyContext;
  /** Optional manual override of the inferred relationship type
   *  (M6.4). When set, the few-shot retrieval skips the classifier
   *  and pulls examples from this bucket directly. */
  readonly relationshipTypeOverride?: RelationshipType;
}

export interface DraftResult {
  readonly quick: string;
  readonly detailed: string;
  readonly subjectLine: string | null;
  readonly resolvedContactId?: string;
  /** M0.x.5: what fed the prompt. Used by the draft modal's
   *  "What I'm using" disclosure so Jennifer can audit provenance. */
  readonly voiceContextUsed?: {
    references: Array<{ id: string; filename: string; sourceType: string }>;
    examples: Array<{ toEmail: string; sentAt: string }>;
    relationshipType: string;
  };
}

interface DraftQualityContext {
  readonly context: DraftContext;
  readonly replyContext: ReplyContext | null;
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
  // M0.x.4/M0.x.18: reply mode must resolve the actual inbound
  // sender before loading contact memory/facts. Inbox classification
  // can attach a thread to the wrong contact in group-ish Gmail
  // threads; the latest inbound email is the authoritative reply
  // recipient.
  let replyContext: ReplyContext | null = params.replyContext ?? null;
  if (
    !replyContext &&
    params.context === "reply_email" &&
    params.threadKey
  ) {
    try {
      replyContext = await loadReplyContext({
        prisma,
        userId: params.userId,
        threadKey: params.threadKey,
      });
    } catch (err) {
      console.warn("[draft-generator] loadReplyContext failed:", err);
    }
  }

  const resolvedContactId = await resolveReplyContactId({
    userId: params.userId,
    requestedContactId: params.contactId,
    replyContext,
  });

  // Gather contact context
  const contact = await prisma.contact.findUnique({
    where: { id: resolvedContactId },
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
    where: { contactId: resolvedContactId, userId: params.userId },
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
    where: { contactId: resolvedContactId, userId: params.userId },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { id: true, content: true, mood: true, createdAt: true },
  });

  // Get ContactMemory (M8.3) — synthesized conversational context.
  // Null when the memory-synthesis worker hasn't run yet for this contact.
  const memory = await prisma.contactMemory.findUnique({
    where: { contactId: resolvedContactId },
    select: {
      discussedTopics: true,
      theyMentioned: true,
      openThreads: true,
      personalContext: true,
      recurringThemes: true,
    },
  });

  const personFacts = await loadPersonFactsForPrompt(prisma, {
    userId: params.userId,
    contactId: resolvedContactId,
  });

  // Get changelog entries (life updates)
  const lifeUpdates = await prisma.contactChangelog.findMany({
    where: { contactId: resolvedContactId, status: { in: ["PENDING", "SEEN"] } },
    orderBy: { detectedAt: "desc" },
    take: 2,
    select: { id: true, type: true, field: true, oldValue: true, newValue: true },
  });

  const inputRefs = [
    `contact:${resolvedContactId}`,
    ...interactions.map((i) => `interaction:${i.id}`),
    ...journalEntries.map((j) => `journal:${j.id}`),
    ...lifeUpdates.map((u) => `changelog:${u.id}`),
    ...(memory ? [`memory:${resolvedContactId}`] : []),
    ...personFacts.map((fact) => `personFact:${fact.id}`),
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
  const personFactsSummary = buildPersonFactsPromptBlock(personFacts);

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
          replyContext,
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
        personFactsSummary,
        replyContext,
        inputRefs: voiceContext
          ? [
              ...inputRefs,
              ...voiceContext.examples.map((e) => `voiceExample:${e.emailMessageId}`),
              ...voiceContext.references.map((r) => `voiceReference:${r.id}`),
            ]
          : inputRefs,
        voiceContext,
        resolvedContactId,
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
      if (params.context === "reply_email") {
        throw new Error(
          "Contextual reply generation failed; generic reply fallback is disabled.",
        );
      }
    }
  }

  if (params.context === "reply_email") {
    throw new Error(
      "ANTHROPIC_API_KEY is required for contextual email replies; generic reply fallback is disabled.",
    );
  }

  return generateFromTemplate({
    ...params,
    firstName,
    company: contact.company,
    circleNames,
    daysSinceLastInteraction: interactions[0]
      ? Math.floor((Date.now() - new Date(interactions[0].occurredAt).getTime()) / 86400000)
      : null,
    resolvedContactId,
  });
}

interface VoiceContext {
  examples: VoiceExampleResult[];
  /** M0.x.5 — primary voice references (KB / style guide / book excerpts).
   *  Dominate over examples in the prompt. */
  references: VoiceReferenceForPrompt[];
  learnedProfile: LearnedProfile | null;
  relationshipType: RelationshipType;
  /** M0.x.12 — Jennifer's free-form custom instructions from
   *  /voice. Highest-priority voice signal; rendered at
   *  the top of the voice block. */
  userInstructions: string | null;
}

async function resolveReplyContactId(args: {
  readonly userId: string;
  readonly requestedContactId: string;
  readonly replyContext: ReplyContext | null;
}): Promise<string> {
  const inboundEmail = args.replyContext?.latestInbound.fromEmail
    ?.trim()
    .toLowerCase();
  if (!inboundEmail) return args.requestedContactId;

  const requested = await prisma.contact.findUnique({
    where: { id: args.requestedContactId },
    select: { id: true, email: true, additionalEmails: true },
  });

  if (contactHasEmail(requested, inboundEmail)) {
    return args.requestedContactId;
  }

  const existing = await prisma.contact.findFirst({
    where: {
      userId: args.userId,
      OR: [
        { email: { equals: inboundEmail, mode: "insensitive" } },
        { additionalEmails: { has: inboundEmail } },
      ],
    },
    select: { id: true },
  });

  if (existing) return existing.id;

  const inboundName = args.replyContext?.latestInbound.fromName?.trim();
  const created = await prisma.contact.create({
    data: {
      userId: args.userId,
      name: inboundName || displayNameFromEmail(inboundEmail),
      email: inboundEmail,
      tags: [],
      source: "GMAIL_DISCOVER",
      importedAt: new Date(),
    },
    select: { id: true },
  });

  return created.id;
}

async function generateWithAI(params: Omit<GenerateDraftParams, "replyContext"> & {
  contact: { name: string; company: string | null; role: string | null; tier: string; notes: string | null };
  firstName: string;
  circleNames: string[];
  interactionsSummary: string;
  journalSummary: string;
  lifeUpdatesSummary: string;
  memorySummary: string;
  personFactsSummary: string;
  inputRefs: string[];
  voiceContext: VoiceContext | null;
  replyContext: ReplyContext | null;
  resolvedContactId: string;
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
- If a "YOU ARE REPLYING TO THIS MESSAGE" block is present, the draft MUST be a direct reply to that message — answer questions asked, acknowledge specific points, match its tone. Do NOT write a generic catch-up email. Pull subject + recipient from the inbound, not invented context.
- When the inbound asks a factual/scheduling/logistics question, look across the prior thread context, recent interactions, source-backed facts, and memory before asking the recipient to repeat themselves. If the answer is known, answer it directly. If it is unknown, be clear and concise about what still needs confirmation.
- Before drafting, silently identify: (1) what the latest message is asking for, (2) what answer or next action ${profile.firstName} can give from the thread/facts/memory, (3) what information is missing, and (4) the relationship-appropriate tone. Do not output this analysis — use it to write the draft.
- Avoid non-answers. Do not say "appreciate you sending this over", "I'll take a closer look", "I'll review and get back to you shortly", or "follow up with thoughts by end of week" unless the inbound message specifically asks for review of attached material and the draft names what will be reviewed.
- Never leave placeholders such as INSERT_MOMS_FIRST_NAME, INSERT_MOMS_FULL_NAME, [name], or TODO in the draft.
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
        references: params.voiceContext.references,
        relationshipType: params.voiceContext.relationshipType,
        userInstructions: params.voiceContext.userInstructions,
      })
    : null;
  const closingGuidance = params.voiceContext
    ? buildClosingGuidance({
        learnedProfile: params.voiceContext.learnedProfile,
        examples: params.voiceContext.examples,
        references: params.voiceContext.references,
        relationshipType: params.voiceContext.relationshipType,
        userInstructions: params.voiceContext.userInstructions,
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

  // M0.x.4: when we have the actual inbound message, prepend a
  // "you are replying to this" block to the user content. It goes
  // OUTSIDE the JSON envelope so Claude sees the message first and
  // structurally — not buried as a string field. The JSON metadata
  // follows for additional context (tone, memory, voice).
  const replyPromptBlock = params.replyContext
    ? buildReplyPromptBlock(params.replyContext) + "\n\n"
    : "";

  // When in reply mode with a loaded body, we suppress the legacy
  // threadSubject/threadSnippet keys in the JSON envelope — they'd
  // duplicate (and truncate) what the reply block already has.
  const isLoadedReply = !!params.replyContext;

  const jsonPayload = JSON.stringify({
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
    threadSubject: isLoadedReply ? undefined : params.threadSubject || undefined,
    threadSnippet: isLoadedReply ? undefined : params.threadSnippet || undefined,
    recentInteractions: params.interactionsSummary || "None",
    journalNotes: params.journalSummary || "None",
    lifeUpdates: params.lifeUpdatesSummary || "None",
    sourceBackedFacts: params.personFactsSummary || "None",
    // M8.3: ContactMemory injected as structured "What I know" text.
    // Empty string when the synthesis worker hasn't profiled this
    // contact yet — model just gets less context, no schema impact.
    whatIKnowAboutThem: params.memorySummary || "None",
  }, null, 2);

  const userContent = `${replyPromptBlock}DRAFT METADATA (use to tune tone + reference context):\n${jsonPayload}`;

  // M0.x.5: surface what fed the prompt so the draft modal can show
  // an audit trail ("Voice references: 3 files · Past emails: 2").
  const voiceContextUsed = params.voiceContext
    ? {
        references: params.voiceContext.references.map((r) => ({
          id: r.id,
          filename: r.filename,
          sourceType: r.sourceType,
        })),
        examples: params.voiceContext.examples.map((e) => ({
          toEmail: e.toEmail,
          sentAt: e.sentAt.toISOString(),
        })),
        relationshipType: params.voiceContext.relationshipType,
      }
    : undefined;

  let tokensIn = 0;
  let tokensOut = 0;
  let cacheHit = false;
  let lastIssues: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const attemptContent =
      attempt === 0
        ? userContent
        : `${userContent}\n\nDRAFT QUALITY CORRECTION:\nYour previous draft was rejected because:\n${lastIssues
            .map((issue) => `- ${issue}`)
            .join("\n")}\n\nRewrite from scratch. The new draft must directly respond to the exact latest message, name the concrete topic/request, answer what can be answered from the supplied context, and avoid generic review/follow-up language.`;

    const message = await anthropic.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 900,
      system: systemBlocks,
      messages: [{ role: "user", content: attemptContent }],
    });

    tokensIn += message.usage?.input_tokens ?? 0;
    tokensOut += message.usage?.output_tokens ?? 0;
    cacheHit ||= (message.usage?.cache_read_input_tokens ?? 0) > 0;

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";
    const result = parseDraftResponse(
      text,
      voiceContextUsed,
      params.resolvedContactId,
    );
    lastIssues = findDraftQualityIssues(result, {
      context: params.context,
      replyContext: params.replyContext,
    });

    if (lastIssues.length === 0) {
      await logAIGeneration({
        userId: params.userId,
        feature: "draft",
        model: DRAFT_MODEL,
        inputRefs: params.inputRefs,
        tokensIn,
        tokensOut,
        cacheHit: cacheHit ? true : null,
        latencyMs: Date.now() - startedAt,
      });
      return result;
    }
  }

  await logAIGeneration({
    userId: params.userId,
    feature: "draft",
    model: DRAFT_MODEL,
    inputRefs: params.inputRefs,
    tokensIn,
    tokensOut,
    cacheHit: cacheHit ? true : null,
    latencyMs: Date.now() - startedAt,
    error: `Draft failed quality gate: ${lastIssues.join("; ")}`,
  });

  throw new Error(`Draft failed quality gate: ${lastIssues.join("; ")}`);
}

function parseDraftResponse(
  text: string,
  voiceContextUsed: DraftResult["voiceContextUsed"],
  resolvedContactId?: string,
): DraftResult {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return {
        quick: typeof parsed.quick === "string" ? parsed.quick : "",
        detailed: typeof parsed.detailed === "string" ? parsed.detailed : "",
        subjectLine:
          typeof parsed.subjectLine === "string" && parsed.subjectLine.trim()
            ? parsed.subjectLine
            : null,
        voiceContextUsed,
        resolvedContactId,
      };
    }
  } catch {
    // Parse failure — caller quality gate will decide whether raw text
    // is acceptable for non-reply workflows.
  }

  return {
    quick: text,
    detailed: text,
    subjectLine: null,
    voiceContextUsed,
    resolvedContactId,
  };
}

const GENERIC_REPLY_PATTERNS: RegExp[] = [
  /appreciate you sending this over/i,
  /take a closer look/i,
  /follow up with thoughts by (?:the )?end of (?:the )?week/i,
  /thanks for the email\.?\s+i(?:'|’)ll review and get back to you shortly/i,
  /i(?:'|’)ll review and get back to you shortly/i,
];

const PLACEHOLDER_PATTERN =
  /\b(?:INSERT_[A-Z0-9_]+|\[[a-z _-]*name[a-z _-]*\]|TODO)\b/i;

export function findDraftQualityIssues(
  result: Pick<DraftResult, "quick" | "detailed">,
  ctx: DraftQualityContext,
): string[] {
  const issues: string[] = [];
  const variants = [
    ["quick", result.quick],
    ["detailed", result.detailed],
  ] as const;

  for (const [label, body] of variants) {
    const text = body.trim();
    if (!text) {
      issues.push(`${label} draft is empty`);
      continue;
    }
    if (PLACEHOLDER_PATTERN.test(text)) {
      issues.push(`${label} draft contains a placeholder`);
    }
    if (GENERIC_REPLY_PATTERNS.some((pattern) => pattern.test(text))) {
      issues.push(`${label} draft uses generic review/follow-up template language`);
    }
  }

  if (ctx.context === "reply_email" && ctx.replyContext) {
    const inboundText = [
      ctx.replyContext.latestInbound.subject,
      ctx.replyContext.latestInbound.body,
    ]
      .filter(Boolean)
      .join("\n");
    const terms = extractSignificantTerms(inboundText);
    if (terms.length >= 3) {
      for (const [label, body] of variants) {
        if (!body.trim()) continue;
        const overlap = countTermOverlap(body, terms);
        if (overlap === 0) {
          issues.push(
            `${label} reply does not reference any specific topic from the latest inbound message`,
          );
        }
      }
    }
  }

  return Array.from(new Set(issues));
}

const TERM_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "being",
  "could",
  "email",
  "from",
  "have",
  "hello",
  "here",
  "just",
  "know",
  "like",
  "look",
  "more",
  "much",
  "need",
  "note",
  "over",
  "please",
  "quick",
  "really",
  "said",
  "send",
  "sending",
  "should",
  "thanks",
  "thank",
  "that",
  "their",
  "there",
  "these",
  "thing",
  "think",
  "this",
  "thought",
  "through",
  "wanted",
  "would",
  "your",
]);

function extractSignificantTerms(text: string): string[] {
  const terms =
    text
      .toLowerCase()
      .match(/[a-z][a-z'-]{3,}/g)
      ?.map((term) => term.replace(/^'+|'+$/g, ""))
      .filter((term) => !TERM_STOPWORDS.has(term)) ?? [];
  return Array.from(new Set(terms)).slice(0, 32);
}

function countTermOverlap(text: string, terms: string[]): number {
  const normalized = ` ${text.toLowerCase()} `;
  return terms.filter((term) => normalized.includes(term)).length;
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
  replyContext?: ReplyContext | null;
}): string {
  const parts: string[] = [
    `Tone: ${TONE_LABELS[params.tone]}`,
    `Context: ${CONTEXT_LABELS[params.context]}`,
  ];
  if (params.contextDetail) parts.push(`Detail: ${params.contextDetail}`);
  // Prefer the loaded reply context over the legacy snippet — gives
  // the voice retriever a better embedding target.
  if (params.replyContext) {
    const inb = params.replyContext.latestInbound;
    if (inb.subject) parts.push(`Subject: ${inb.subject}`);
    // Cap to ~600 chars so the embedding doesn't drift toward
    // signature noise.
    parts.push(`Their message: ${inb.body.slice(0, 600)}`);
  } else {
    if (params.threadSubject) parts.push(`Subject: ${params.threadSubject}`);
    if (params.threadSnippet)
      parts.push(`Their message: ${params.threadSnippet}`);
  }
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
  // M0.x.5: voice references can power the prompt even without
  // Voyage (we filter by applicableRelationships + recency in that
  // case). So the early-return changed: only bail when we have no
  // recipient AND no references possible.
  const hasVoyage = !!process.env.VOYAGE_API_KEY;
  if (!args.recipientEmail && !hasVoyage) return null;

  try {
    const relationshipType =
      args.relationshipTypeOverride ??
      (args.recipientEmail
        ? await classifyRecipient({
            prisma,
            userId: args.userId,
            recipientEmail: args.recipientEmail,
          })
        : "unknown");

    // Embed the draft intent ONCE — both the example retriever and
    // the reference retriever can use it for semantic ranking.
    let queryEmbeddingLiteral: string | null = null;
    if (hasVoyage) {
      try {
        const { embeddings } = await embedBatch(
          [args.draftIntent.slice(0, 4000)],
          "query",
        );
        if (embeddings.length > 0) {
          queryEmbeddingLiteral = formatVectorLiteral(embeddings[0]);
        }
      } catch {
        // Continue without semantic ranking — references fall back
        // to recency, examples retrieval errors are handled below.
      }
    }

    const [examples, profile, references] = await Promise.all([
      // Examples need Voyage + a recipient email. Skip if either
      // missing — we still surface references on their own.
      hasVoyage && args.recipientEmail
        ? getVoiceExamples({
            prisma,
            userId: args.userId,
            recipientEmail: args.recipientEmail,
            draftIntent: args.draftIntent,
            k: VOICE_EXAMPLE_COUNT,
            relationshipTypeOverride: args.relationshipTypeOverride,
          }).catch((err) => {
            console.warn("[draft-generator] examples retrieval failed:", err);
            return [] as VoiceExampleResult[];
          })
        : Promise.resolve([] as VoiceExampleResult[]),
      prisma.voiceProfile.findUnique({
        where: { userId: args.userId },
        select: { learned: true, userInstructions: true },
      }),
      getVoiceReferences({
        prisma,
        userId: args.userId,
        queryEmbeddingLiteral,
        relationshipType,
      }).catch((err) => {
        console.warn("[draft-generator] references retrieval failed:", err);
        return [] as VoiceReferenceForPrompt[];
      }),
    ]);
    const learnedProfile =
      (profile?.learned as unknown as LearnedProfile | null) ?? null;
    const userInstructions = profile?.userInstructions ?? null;
    const ctx: VoiceContext = {
      examples,
      references,
      learnedProfile,
      relationshipType,
      userInstructions,
    };
    // If there's truly nothing to inject, return null so the caller
    // takes the cheaper non-voice path.
    if (
      !hasVoiceContext({
        learnedProfile,
        examples,
        references,
        relationshipType,
        userInstructions,
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
  resolvedContactId: string;
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
      quick: `Hey ${firstName}, I saw your note${threadSubject ? ` about ${threadSubject.replace(/^Re:\s*/i, "")}` : ""}. I want to answer this specifically, but I need the full thread context before drafting a real reply.`,
      detailed: `Hey ${firstName}, I saw your note${threadSubject ? ` about "${threadSubject.replace(/^Re:\s*/i, "")}"` : ""}. I don't want to send a generic response here without the actual thread context. Once the message body is available, I can answer the specific question or next step directly.`,
      subjectLine: threadSubject ? `Re: ${threadSubject.replace(/^Re:\s*/i, "")}` : null,
    },
    "professional_reply_email": {
      quick: `Hi ${firstName}, I saw your note${threadSubject ? ` about ${threadSubject.replace(/^Re:\s*/i, "")}` : ""}. I need the full thread context before drafting a specific reply.`,
      detailed: `Hi ${firstName}, I saw your note${threadSubject ? ` about "${threadSubject.replace(/^Re:\s*/i, "")}"` : ""}. I don't want to send a generic response without the actual message context. Once the full thread is available, I can answer the specific question or next step directly.${signoff}`,
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
  if (templates[key]) {
    return { ...templates[key], resolvedContactId: params.resolvedContactId };
  }

  // Fallback: try tone category
  const toneCategory = isCasual ? "casual" : tone === "congratulatory" ? "congratulatory" : "professional";
  const fallbackKey = `${toneCategory}_${context}`;
  if (templates[fallbackKey]) {
    return {
      ...templates[fallbackKey],
      resolvedContactId: params.resolvedContactId,
    };
  }

  // Fallback: try warm variant
  const warmKey = `warm_${context}`;
  if (templates[warmKey]) {
    return { ...templates[warmKey], resolvedContactId: params.resolvedContactId };
  }

  // Ultimate fallback
  return {
    quick: `Hey ${firstName}, wanted to reach out. Let me know if you have a moment to chat.`,
    detailed: `Hey ${firstName}, hope you're doing well${companyRef}. I wanted to reach out and connect — it's been a while since we last talked. Would love to catch up if you have some time.${signoff}`,
    subjectLine: `Hey ${firstName}`,
    resolvedContactId: params.resolvedContactId,
  };
}
