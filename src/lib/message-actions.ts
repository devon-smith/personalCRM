import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

// ─── Types ───────────────────────────────────────────────────

type Classification = "action_required" | "invitation" | "fyi";

interface AIClassification {
  readonly classification: Classification;
  readonly title: string | null;
  readonly urgency: "low" | "medium" | "high" | null;
  readonly reasoning: string;
}

export interface MessageActionResult {
  readonly processed: number;
  readonly actionItemsCreated: number;
  readonly skipped: number;
  readonly errors: number;
}

// ─── AI classification ───────────────────────────────────────

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function classifyMessage(
  contactName: string,
  channel: string,
  summary: string,
  subject?: string | null,
): Promise<AIClassification | null> {
  try {
    const subjectLine = subject && subject !== `${channel} message`
      ? `\nSubject: "${subject}"`
      : "";
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `You are classifying a text message for a personal CRM. Your job is to determine if this message contains a DIRECT REQUEST for the recipient to take a specific real-world action.

Message from ${contactName} via ${channel}:
${subjectLine}
"${summary.slice(0, 500)}"

An action item means the sender is EXPLICITLY asking the recipient to DO something specific. The key word is "asking" — the sender must be directing a request AT the recipient.

Classify as "action_required" ONLY if ALL of these are true:
1. The sender is making a request directed at the recipient (not sharing info)
2. The request requires a real-world action beyond just texting back
3. The action is specific and concrete (not vague like "let's hang out sometime")

Examples of action_required:
- "Can you send me the deck?" → YES (send something)
- "Can you intro me to Sarah?" → YES (make a connection)
- "Please book the restaurant for Saturday" → YES (make a reservation)
- "Can you review this doc and give feedback?" → YES (review something)
- "You said you'd send me that link" → YES (unfulfilled commitment)
- "Can you Venmo me $20 for last night?" → YES (send money)
- "Can you pick up groceries?" → YES (physical task)

Examples that are NOT action_required:
- "I'm up for Alpine" → NO (sharing their plan, not asking you to do anything)
- "I have an invite to meet up with Sophie" → NO (sharing info)
- "You should get a shower beer" → NO (casual suggestion, not a real request)
- "Are you going to the party?" → NO (question needing a reply, not an action)
- "Want to grab lunch?" → NO (casual, not a directed task)
- "Sounds good see you there" → NO (confirmation)
- "Haha that's hilarious" → NO (reaction)
- "I'm running late" → NO (status update)
- "Check out this article" → NO (suggestion, not a directed task)
- "We should do that sometime" → NO (vague, no specific ask)
- "Were you thinking of coming up to the city?" → NO (question, not a task)
- "I'm at the green mesquite" → NO (sharing location, not asking you to come)
- "The remote dream baby! 6 months US 6 months EU" → NO (sharing excitement)

Classify as "invitation" ONLY if the sender is EXPLICITLY inviting the recipient to a specific event with a concrete time, date, or place mentioned:
- "Dinner at my place Friday at 7?" → YES (specific event + time + place)
- "Want to play tennis Saturday morning?" → YES (specific activity + time)
- "You're invited to my birthday party March 20th" → YES (specific event + date)
- "We should hang out sometime" → NO (too vague)
- "I'm going to Alpine" → NO (telling you their plans, not inviting you)
- "Want to grab lunch?" → NO (no specific time/place)
- "Wanna have a drink at ur place" → NO (casual, no specific time)

If there is no specific time, date, or place mentioned, it is NOT an invitation.

Everything else is "fyi". When in doubt, classify as "fyi". It is much better to miss an action item than to create a false one.

Return JSON only:
{
  "classification": "action_required",
  "title": "Send Cooper the pitch deck",
  "urgency": "medium",
  "reasoning": "one sentence why"
}

If classification is "fyi", set title to null and urgency to null.`,
        },
      ],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as AIClassification;
  } catch (error) {
    console.error("[message-actions] AI classification failed:", error);
    return null;
  }
}

// ─── Main extraction ─────────────────────────────────────────

const ACTIONABLE_CLASSIFICATIONS: ReadonlySet<Classification> = new Set([
  "action_required",
  "invitation",
]);

export async function extractMessageActions(
  userId: string,
): Promise<MessageActionResult> {
  const result = { processed: 0, actionItemsCreated: 0, skipped: 0, errors: 0 };

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  // Get recent inbound interactions not yet analyzed
  const interactions = await prisma.interaction.findMany({
    where: {
      userId,
      direction: "INBOUND",
      type: { in: ["MESSAGE", "EMAIL"] },
      occurredAt: { gte: sixtyDaysAgo },
      dismissedAt: null,
    },
    orderBy: { occurredAt: "desc" },
    take: 200,
    select: {
      id: true,
      contactId: true,
      type: true,
      channel: true,
      subject: true,
      summary: true,
      occurredAt: true,
      contact: {
        select: { name: true },
      },
    },
  });

  // Check which ones already have action items (batch lookup)
  const interactionIds = interactions.map((i) => i.id);
  const existingItems = await prisma.actionItem.findMany({
    where: {
      userId,
      sourceId: { in: interactionIds.map((id) => `msg:${id}`) },
    },
    select: { sourceId: true },
  });
  const processedIds = new Set(existingItems.map((a) => a.sourceId));

  let processedCount = 0;
  const MAX_PER_RUN = 50;

  // Track action items created in this batch for in-memory dedup
  // Key: contactId, Value: array of occurredAt timestamps (ms)
  const batchActionTimes = new Map<string, number[]>();

  for (const ix of interactions) {
    if (processedCount >= MAX_PER_RUN) break;

    const sourceId = `msg:${ix.id}`;
    if (processedIds.has(sourceId)) {
      result.skipped++;
      continue;
    }

    // Skip very short messages
    const summary = ix.summary?.trim() ?? "";
    if (summary.length < 10) {
      result.skipped++;
      continue;
    }

    processedCount++;
    result.processed++;

    const classification = await classifyMessage(
      ix.contact.name,
      ix.channel ?? ix.type,
      summary,
      ix.subject,
    );

    if (!classification) {
      result.errors++;
      continue;
    }

    if (!ACTIONABLE_CLASSIFICATIONS.has(classification.classification)) {
      // Store a marker so we don't re-process, but as DISMISSED
      await prisma.actionItem.create({
        data: {
          userId,
          contactId: ix.contactId,
          status: "DISMISSED",
          title: classification.title || "FYI",
          context: summary.slice(0, 500),
          sourceId,
        },
      });
      continue;
    }

    // Dedup: check for same contact within 5-minute window
    // First check in-memory (catches dupes within same batch)
    const fiveMinMs = 5 * 60 * 1000;
    const occurredTime = ix.occurredAt.getTime();
    const existingTimes = batchActionTimes.get(ix.contactId) ?? [];
    const isDupInBatch = existingTimes.some(
      (t) => Math.abs(occurredTime - t) < fiveMinMs,
    );

    if (isDupInBatch) {
      await prisma.actionItem.create({
        data: {
          userId,
          contactId: ix.contactId,
          status: "DISMISSED",
          title: "Duplicate",
          context: summary.slice(0, 200),
          sourceId,
        },
      });
      result.skipped++;
      continue;
    }

    // Then check DB for items from prior batches
    const dbActions = await prisma.actionItem.findMany({
      where: {
        userId,
        contactId: ix.contactId,
        status: { not: "DISMISSED" },
        sourceId: { startsWith: "msg:" },
      },
      select: { context: true },
    });

    const isDupInDb = dbActions.some((a) => {
      try {
        const ctx = a.context ? JSON.parse(a.context) : null;
        if (ctx?.occurredAt) {
          return Math.abs(occurredTime - new Date(ctx.occurredAt).getTime()) < fiveMinMs;
        }
      } catch { /* ignore */ }
      return false;
    });

    if (isDupInDb) {
      await prisma.actionItem.create({
        data: {
          userId,
          contactId: ix.contactId,
          status: "DISMISSED",
          title: "Duplicate",
          context: summary.slice(0, 200),
          sourceId,
        },
      });
      result.skipped++;
      continue;
    }

    // Create actionable item — store clean data
    const messagePreview = summary.slice(0, 200);
    await prisma.actionItem.create({
      data: {
        userId,
        contactId: ix.contactId,
        status: "OPEN",
        title: classification.title || "Action needed",
        context: JSON.stringify({
          classification: classification.classification,
          urgency: classification.urgency ?? "medium",
          reasoning: classification.reasoning,
          channel: ix.channel,
          preview: messagePreview,
          occurredAt: ix.occurredAt.toISOString(),
        }),
        sourceId,
      },
    });

    // Track this item's timestamp for in-batch dedup
    const times = batchActionTimes.get(ix.contactId) ?? [];
    times.push(occurredTime);
    batchActionTimes.set(ix.contactId, times);

    result.actionItemsCreated++;
  }

  return result;
}

// ─── Fetch recent message action items ───────────────────────

export interface MessageActionItem {
  readonly id: string;
  readonly status: string;
  readonly title: string;
  readonly classification: string;
  readonly urgency: string;
  readonly reasoning: string;
  readonly channel: string | null;
  readonly preview: string | null;
  readonly contactId: string | null;
  readonly contactName: string | null;
  readonly occurredAt: string | null;
  readonly extractedAt: string;
}

export async function getMessageActionItems(
  userId: string,
): Promise<readonly MessageActionItem[]> {
  const items = await prisma.actionItem.findMany({
    where: {
      userId,
      status: "OPEN",
      OR: [
        { sourceId: { startsWith: "msg:" } },
        { sourceId: { startsWith: "email:" } },
      ],
    },
    orderBy: { extractedAt: "desc" },
    take: 20,
    include: {
      contact: {
        select: { id: true, name: true },
      },
    },
  });

  return items.map((item) => {
    // Parse the JSON context — handle both old and new format
    let classification = "action_required";
    let urgency = "medium";
    let reasoning = "";
    let channel: string | null = null;
    let preview: string | null = null;
    let occurredAt: string | null = null;

    if (item.context) {
      try {
        const parsed = JSON.parse(item.context);
        classification = parsed.classification ?? "action_required";
        urgency = parsed.urgency ?? "medium";
        reasoning = parsed.reasoning ?? "";
        channel = parsed.channel ?? null;
        preview = parsed.preview ?? null;
        occurredAt = parsed.occurredAt ?? null;
      } catch {
        // Non-JSON context = plain text preview from old format
        preview = item.context.slice(0, 200);
      }
    }

    return {
      id: item.id,
      status: item.status,
      title: item.title,
      classification,
      urgency,
      reasoning,
      channel,
      preview,
      contactId: item.contact?.id ?? null,
      contactName: item.contact?.name ?? null,
      occurredAt,
      extractedAt: item.extractedAt.toISOString(),
    };
  });
}
