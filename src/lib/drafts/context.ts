/**
 * Build the shared RefineContextSummary for a Draft (M0.x.6).
 *
 * Pulls everything Claude needs to refine or generate variants from
 * a draft row: recipient + relationship + memory + reply context +
 * voice references. One place to assemble it so the refinement
 * endpoint, the variants endpoint, and the initial-generate path
 * stay consistent.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import type { RefineContextSummary } from "./refine";
import { loadReplyContext } from "@/lib/draft-reply-context";
import { classifyRecipient } from "@/lib/voice/relationship-classifier";
import { getVoiceReferences } from "@/lib/voice/references/retrieval";
import { embedBatch, formatVectorLiteral } from "@/lib/search/embeddings";
import { buildMemorySummary } from "@/lib/draft-generator";

export async function buildRefineContext(args: {
  prisma: PrismaClient;
  userId: string;
  contactId: string;
  threadKey: string | null;
  /** Optional pre-computed intent text to bias reference retrieval. */
  queryText?: string;
}): Promise<RefineContextSummary> {
  const contact = await args.prisma.contact.findUnique({
    where: { id: args.contactId },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });
  if (!contact) {
    throw new Error(`Contact ${args.contactId} not found`);
  }

  // Reply context — only relevant when this is a reply
  // (caller's threadKey is null otherwise).
  const replyContext = args.threadKey
    ? await loadReplyContext({
        prisma: args.prisma,
        userId: args.userId,
        threadKey: args.threadKey,
      }).catch(() => null)
    : null;

  // Relationship type — use the classifier cascade (cheap if cached).
  const relationshipType = contact.email
    ? await classifyRecipient({
        prisma: args.prisma,
        userId: args.userId,
        recipientEmail: contact.email,
      }).catch(() => "unknown" as const)
    : "unknown";

  // Voice references — embed the query text if available so we rank
  // by relevance, otherwise fall back to recency.
  let queryEmbeddingLiteral: string | null = null;
  if (process.env.VOYAGE_API_KEY && args.queryText) {
    try {
      const { embeddings } = await embedBatch(
        [args.queryText.slice(0, 4000)],
        "query",
      );
      if (embeddings.length > 0) {
        queryEmbeddingLiteral = formatVectorLiteral(embeddings[0]);
      }
    } catch {
      // Recency fallback.
    }
  }

  const references = await getVoiceReferences({
    prisma: args.prisma,
    userId: args.userId,
    queryEmbeddingLiteral,
    relationshipType,
  }).catch(() => []);

  // Memory — synthesized contact memory if present.
  const memory = await args.prisma.contactMemory.findUnique({
    where: { contactId: args.contactId },
    select: {
      discussedTopics: true,
      theyMentioned: true,
      openThreads: true,
      personalContext: true,
      recurringThemes: true,
    },
  });
  const memorySummary = memory ? buildMemorySummary(memory) : "";

  // M0.x.12 — load Jennifer's custom voice instructions so refinements
  // + variants honor the same global voice rules as the draft pipeline.
  const profile = await args.prisma.voiceProfile.findUnique({
    where: { userId: args.userId },
    select: { userInstructions: true },
  });

  const firstName = contact.name.split(" ")[0] ?? contact.name;

  return {
    recipientFirstName: firstName,
    recipientFullName: contact.name,
    recipientEmail: contact.email,
    relationshipType,
    memorySummary,
    replyContext,
    references,
    userInstructions: profile?.userInstructions ?? null,
  };
}
