/**
 * Few-shot voice example retrieval (M6.3.2).
 *
 * Given a draft intent + recipient, return the K most-similar past
 * outbound emails Jennifer wrote to people in the same relationship
 * type. These get injected into the draft-generation prompt (M6.3.3)
 * so Claude has concrete examples of how Jennifer actually writes to
 * this kind of person, not just a learned-profile summary.
 *
 * Retrieval is two-stage:
 *   1. Voyage-embed the draft intent (query embedding)
 *   2. pgvector cosine similarity over VoiceExample.embedding,
 *      filtered to the recipient's relationship type
 *
 * Fallback per the plan: if the type-matched bucket has fewer than K
 * embedded examples, pad with cross-type matches. Four reasonable
 * examples beats one perfect one.
 */

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { embedBatch, formatVectorLiteral } from "@/lib/search/embeddings";
import {
  classifyRecipient,
  type RelationshipType,
} from "./relationship-classifier";
import { extractFeatures } from "./feature-extraction";

export interface GetVoiceExamplesParams {
  prisma: PrismaClient;
  userId: string;
  /** Email address of the person Jennifer is writing to. */
  recipientEmail: string;
  /** Free-text description of what the draft is about. Subject + a
   *  sentence of intent is plenty; full body works but we only embed
   *  the first 8K chars. */
  draftIntent: string;
  /** Target number of examples. Defaults to 4 per the plan. */
  k?: number;
  /** Manual override for the recipient's relationship type — set when
   *  the user explicitly picks a different bucket in the draft modal
   *  pill (M6.4). Bypasses the classifier cascade entirely. */
  relationshipTypeOverride?: RelationshipType;
}

export interface VoiceExampleResult {
  emailMessageId: string;
  /** Who Jennifer wrote it to. Pulled from EmailMessage.toEmail; the
   *  contact name is joined from the Contact table if one exists. */
  toEmail: string;
  recipientName: string | null;
  sentAt: Date;
  relationshipType: string;
  /** Whether this row matched the recipient's relationship type
   *  ("primary") or was pulled in via the cross-type fallback. */
  matchKind: "primary" | "fallback";
  openingType: string | null;
  closingType: string | null;
  wordCount: number;
  avgSentenceLen: number;
  /** Cleaned body — quote-stripped + sig-stripped. This is what gets
   *  injected into the draft-generation prompt. */
  body: string;
  /** Cosine similarity, 0–1. Useful for diagnostics + the comparison
   *  UI in M6.3.4. */
  similarity: number;
}

const DEFAULT_K = 4;
const INTENT_MAX_CHARS = 8000;

/**
 * Main entry point. Throws if VOYAGE_API_KEY isn't configured (the
 * caller should fall back to the learned-profile-only prompt in that
 * case — we can't do retrieval without the query embedding).
 */
export async function getVoiceExamples(
  params: GetVoiceExamplesParams,
): Promise<VoiceExampleResult[]> {
  if (!process.env.VOYAGE_API_KEY) {
    throw new Error(
      "VOYAGE_API_KEY not configured — few-shot retrieval unavailable",
    );
  }
  const { prisma, userId, recipientEmail, draftIntent } = params;
  const k = params.k ?? DEFAULT_K;

  // Stage 1: determine the recipient's relationship type. Manual
  // override (from the M6.4 draft-modal pill) wins over the
  // classifier cascade — Jennifer knowing the relationship is more
  // reliable than our inference.
  const relationshipType =
    params.relationshipTypeOverride ??
    (await classifyRecipient({
      prisma,
      userId,
      recipientEmail,
    }));

  // Stage 2: embed the draft intent. "query" input type per Voyage's
  // documented asymmetric retrieval pattern — stored examples are
  // "document", search vectors are "query".
  const truncated = draftIntent.slice(0, INTENT_MAX_CHARS);
  const { embeddings } = await embedBatch([truncated], "query", {
    userId,
    feature: "voice_few_shot_retrieval",
    metadata: { relationshipType, k },
  });
  if (embeddings.length === 0) return [];
  const literal = formatVectorLiteral(embeddings[0]);

  // Stage 3: primary search — same relationship type, top-K by
  // cosine similarity.
  const primary = await querySimilarExamples({
    prisma,
    userId,
    literal,
    relationshipType,
    limit: k,
  });

  // Stage 4: fallback — if primary is short, pull more from any
  // relationship type (excluding rows we already have).
  type TaggedRow = RawSimilarityRow & { matchKind: "primary" | "fallback" };
  const combined: TaggedRow[] = primary.map((r) => ({
    ...r,
    matchKind: "primary",
  }));
  if (combined.length < k) {
    const excludeIds = new Set(combined.map((r) => r.emailMessageId));
    const fallback = await querySimilarExamples({
      prisma,
      userId,
      literal,
      relationshipType: null, // any type
      limit: k - combined.length,
      excludeIds,
    });
    for (const row of fallback) {
      combined.push({ ...row, matchKind: "fallback" });
    }
  }

  // Stage 5: hydrate with cleaned body. VoiceExample stores the
  // extracted features but not the body text — we pull EmailMessage
  // .fullBody and re-extract, applying the user's stored
  // signatureLines so the body Claude sees matches what the
  // fingerprint was built on.
  return hydrateBodies(prisma, userId, combined);
}

// ─── Pure helpers — testable in isolation ──────────────────

interface RawSimilarityRow {
  emailMessageId: string;
  toEmail: string;
  sentAt: Date;
  relationshipType: string;
  openingType: string | null;
  closingType: string | null;
  wordCount: number;
  avgSentenceLen: number;
  similarity: number;
  recipientName: string | null;
}

interface QuerySimilarParams {
  prisma: PrismaClient;
  userId: string;
  literal: string;
  relationshipType: RelationshipType | null;
  limit: number;
  excludeIds?: Set<string>;
}

async function querySimilarExamples(
  params: QuerySimilarParams,
): Promise<RawSimilarityRow[]> {
  const { prisma, userId, literal, relationshipType, limit, excludeIds } =
    params;
  if (limit <= 0) return [];

  // pgvector's `<=>` is cosine distance (0 = identical, 1 = orthogonal,
  // 2 = opposite). Cosine similarity = 1 - distance. We filter to rows
  // with non-null embeddings (M6.3.1 backfill incomplete until Voyage
  // payment is added, so many rows have null) and exclude any IDs the
  // caller already has from a prior query.
  const excludeArr = excludeIds ? Array.from(excludeIds) : [];
  const relationshipFilter = relationshipType
    ? Prisma.sql`AND ve."relationshipType" = ${relationshipType}`
    : Prisma.empty;
  const excludeFilter =
    excludeArr.length > 0
      ? Prisma.sql`AND ve."emailMessageId" NOT IN (${Prisma.join(excludeArr)})`
      : Prisma.empty;

  return prisma.$queryRaw<RawSimilarityRow[]>(Prisma.sql`
    SELECT ve."emailMessageId",
           em."toEmail",
           ve."sentAt",
           ve."relationshipType",
           ve."openingType",
           ve."closingType",
           ve."wordCount",
           ve."avgSentenceLen",
           (1 - (ve."embedding" <=> ${literal}::vector))::float8 AS similarity,
           c."name" AS "recipientName"
    FROM "VoiceExample" ve
    JOIN "EmailMessage" em ON em.id = ve."emailMessageId"
    LEFT JOIN "Contact" c
      ON c."userId" = ve."userId"
      AND lower(c."email") = lower(em."toEmail")
    WHERE ve."userId" = ${userId}
      AND ve."embedding" IS NOT NULL
      ${relationshipFilter}
      ${excludeFilter}
    ORDER BY ve."embedding" <=> ${literal}::vector ASC
    LIMIT ${limit}
  `);
}

async function hydrateBodies(
  prisma: PrismaClient,
  userId: string,
  rows: Array<RawSimilarityRow & { matchKind: "primary" | "fallback" }>,
): Promise<VoiceExampleResult[]> {
  if (rows.length === 0) return [];

  // One round-trip for all bodies + one for the user's signatureLines.
  const [messages, profile] = await Promise.all([
    prisma.emailMessage.findMany({
      where: { id: { in: rows.map((r) => r.emailMessageId) } },
      select: { id: true, fullBody: true },
    }),
    prisma.voiceProfile.findUnique({
      where: { userId },
      select: { signatureLines: true },
    }),
  ]);
  const bodyMap = new Map(messages.map((m) => [m.id, m.fullBody ?? ""]));
  const sigLines = profile?.signatureLines ?? [];

  return rows.map((r) => {
    const rawBody = bodyMap.get(r.emailMessageId) ?? "";
    const features = extractFeatures(rawBody, sigLines);
    return {
      emailMessageId: r.emailMessageId,
      toEmail: r.toEmail,
      recipientName: r.recipientName,
      sentAt: r.sentAt,
      relationshipType: r.relationshipType,
      matchKind: r.matchKind,
      openingType: r.openingType,
      closingType: r.closingType,
      wordCount: r.wordCount,
      avgSentenceLen: r.avgSentenceLen,
      body: features.cleanedBody,
      similarity: r.similarity,
    };
  });
}

// ─── Pure fallback-selection helper (extracted for testing) ──

/**
 * Given a set of primary results and fallback candidates, build the
 * final K-sized array honoring the matchKind tagging. Exported only
 * for unit testability — the real flow inlines this logic in
 * getVoiceExamples above.
 */
export function selectWithFallback<T extends { emailMessageId: string }>(
  primary: T[],
  fallbackCandidates: T[],
  k: number,
): Array<T & { matchKind: "primary" | "fallback" }> {
  const tagged: Array<T & { matchKind: "primary" | "fallback" }> = primary.map(
    (p) => ({ ...p, matchKind: "primary" }),
  );
  if (tagged.length >= k) return tagged.slice(0, k);

  const seen = new Set(tagged.map((t) => t.emailMessageId));
  for (const candidate of fallbackCandidates) {
    if (tagged.length >= k) break;
    if (seen.has(candidate.emailMessageId)) continue;
    tagged.push({ ...candidate, matchKind: "fallback" });
    seen.add(candidate.emailMessageId);
  }
  return tagged;
}
