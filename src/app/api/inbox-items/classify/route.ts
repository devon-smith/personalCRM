import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You classify the LAST MESSAGE in a conversation to determine if "Devon" needs to reply.

IMPORTANT: You are ONLY classifying the FINAL message. Ignore whether Devon replied earlier in the conversation. Focus solely on what the last message says and whether it expects Devon's response.

needsReply: true (SHOW in inbox):
- Any question directed at Devon → reason: "question"
- Any request, ask, or invitation → reason: "request"
- Someone shared something emotional or vulnerable → reason: "emotional"
- The message starts a new topic or opens a thread → reason: "open_thread"
- Someone is making plans or coordinating logistics → reason: "request"
- You are unsure → reason: "open_thread"

needsReply: false (HIDE from inbox) — ONLY use when you are very confident:
- The last message is ONLY a brief thank-you with no new content (e.g. "thanks!", "ty", "thank you!") → reason: "acknowledged"
- The last message is ONLY a short reaction with no substance (e.g. "lol", "haha", "bet", "gg", emoji-only) → reason: "winding_down"
- The last message is a newsletter, automated email, or mass notification → reason: "fyi"
- Group chat where the last message does not address Devon at all → reason: "not_addressed"

CRITICAL: Err heavily toward needsReply: true. A message like "Going to X tonight?" is a question (true). "Down for a walk?" is a question (true). "Come through" is an invitation (true). Only say false for genuinely closed-ended acknowledgments.

Respond with ONLY JSON: {"needsReply": true/false, "reason": "...", "confidence": 0.0-1.0}`;

interface ClassifyResult {
  needsReply: boolean;
  reason: string;
  confidence: number;
}

function parseClassifyResponse(text: string): ClassifyResult {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.needsReply === "boolean" && typeof parsed.reason === "string") {
        return {
          needsReply: parsed.needsReply,
          reason: parsed.reason,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        };
      }
    }
  } catch {
    // fail-open
  }
  return { needsReply: true, reason: "parse_error", confidence: 0.0 };
}

/**
 * POST /api/inbox-items/classify
 *
 * Classifies unclassified inbox candidates using Claude Haiku.
 * For each chat where the latest inbound Interaction has needsReply = NULL,
 * fetches the last 8 messages and asks Haiku if Devon needs to reply.
 *
 * Fail-open: errors result in needsReply = true.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    // Find the latest inbound interaction per chatId that hasn't been classified
    const unclassified = await prisma.$queryRaw<
      { id: string; chatId: string; contactId: string; isGroupChat: boolean }[]
    >`
      SELECT DISTINCT ON ("chatId")
        "id", "chatId", "contactId", "isGroupChat"
      FROM "Interaction"
      WHERE "userId" = ${userId}
        AND "chatId" IS NOT NULL
        AND "direction" = 'INBOUND'
        AND "type" != 'NOTE'
        AND "dismissedAt" IS NULL
        AND "occurredAt" > ${thirtyDaysAgo}
        AND "needsReply" IS NULL
      ORDER BY "chatId", "occurredAt" DESC
    `;

    if (unclassified.length === 0) {
      return NextResponse.json({ classified: 0, total: 0 });
    }

    // Batch-fetch contact names for all unclassified items
    const contactIds = [...new Set(unclassified.map((r) => r.contactId))];
    const contacts = await prisma.contact.findMany({
      where: { id: { in: contactIds } },
      select: { id: true, name: true },
    });
    const contactNameMap = new Map(contacts.map((c) => [c.id, c.name]));

    // Batch-fetch last 8 messages for each chatId
    const chatIds = unclassified.map((r) => r.chatId);
    const allMessages = await prisma.$queryRaw<
      { chatId: string; direction: string; summary: string | null; occurredAt: Date; contactId: string }[]
    >`
      SELECT "chatId", "direction", "summary", "occurredAt", "contactId"
      FROM (
        SELECT "chatId", "direction", "summary", "occurredAt", "contactId",
               ROW_NUMBER() OVER (PARTITION BY "chatId" ORDER BY "occurredAt" DESC) as rn
        FROM "Interaction"
        WHERE "userId" = ${userId}
          AND "chatId" IN (${Prisma.join(chatIds)})
          AND "type" != 'NOTE'
          AND "occurredAt" > ${thirtyDaysAgo}
      ) sub
      WHERE rn <= 8
      ORDER BY "chatId", "occurredAt" ASC
    `;

    // Group messages by chatId
    const messagesByChatId = new Map<string, typeof allMessages>();
    for (const msg of allMessages) {
      const list = messagesByChatId.get(msg.chatId) ?? [];
      list.push(msg);
      messagesByChatId.set(msg.chatId, list);
    }

    // Classify each unclassified item (concurrently, batched in groups of 10)
    let classified = 0;
    const errors: string[] = [];
    const BATCH_SIZE = 10;

    for (let i = 0; i < unclassified.length; i += BATCH_SIZE) {
      const batch = unclassified.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (item) => {
          const messages = messagesByChatId.get(item.chatId) ?? [];
          const contactName = contactNameMap.get(item.contactId) ?? "Unknown";
          const chatType = item.isGroupChat ? "GROUP CHAT" : "1:1 CONVERSATION";

          // Build conversation transcript
          const transcript = messages
            .map((m) => {
              const speaker = m.direction === "OUTBOUND"
                ? "Devon"
                : contactNameMap.get(m.contactId) ?? "Unknown";
              return `${speaker}: ${m.summary ?? "(no text)"}`;
            })
            .join("\n");

          // Identify the last message for emphasis
          const lastMsg = messages.length > 0
            ? messages[messages.length - 1]
            : null;
          const lastSpeaker = lastMsg
            ? (lastMsg.direction === "OUTBOUND" ? "Devon" : contactNameMap.get(lastMsg.contactId) ?? "Unknown")
            : "Unknown";
          const lastText = lastMsg?.summary ?? "(no text)";

          const userMessage = `${chatType} with ${contactName}:\n\n${transcript}\n\nThe LAST MESSAGE is from ${lastSpeaker}: "${lastText}"\n\nDoes Devon need to reply to this last message?`;

          let result: ClassifyResult;
          try {
            const response = await anthropic.messages.create({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 100,
              system: SYSTEM_PROMPT,
              messages: [{ role: "user", content: userMessage }],
            });

            const text = response.content[0].type === "text" ? response.content[0].text : "";
            result = parseClassifyResponse(text);
          } catch {
            // Fail-open: if API call fails, mark as needs reply
            result = { needsReply: true, reason: "api_error", confidence: 0.0 };
          }

          // Update the interaction row
          await prisma.interaction.update({
            where: { id: item.id },
            data: {
              needsReply: result.needsReply,
              needsReplyReason: result.reason,
              needsReplyConfidence: result.confidence,
              classifiedAt: new Date(),
            },
          });

          return result;
        }),
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          classified++;
        } else {
          errors.push(r.reason?.message ?? String(r.reason));
        }
      }
    }

    return NextResponse.json({
      classified,
      total: unclassified.length,
      ...(errors.length > 0 && { errors: errors.slice(0, 5) }),
    });
  } catch (error) {
    console.error("[POST /api/inbox-items/classify]", error);
    return NextResponse.json(
      { error: "Classification failed" },
      { status: 500 },
    );
  }
}
