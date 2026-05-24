import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { embedBatch, formatVectorLiteral } from "./embeddings";

export interface ContactSearchHit {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  tier: string;
  avatarUrl: string | null;
  /** 0..1, higher is more relevant. Lets the UI render a confidence dot. */
  score: number;
  /** Which signal contributed most: "exact_email" | "name" | "company" | "semantic" */
  matchReason: string;
}

const DEFAULT_LIMIT = 12;
const TRIGRAM_THRESHOLD = 0.3;
const SEMANTIC_MIN_SIMILARITY = 0.55; // cosine similarity floor
const SEMANTIC_WEIGHT = 0.85; // ranked below exact-email but above trigram

/**
 * Search contacts using a layered strategy:
 *   1. Exact email match (case-insensitive) — always rank 1
 *   2. Trigram similarity on name (Postgres `%` operator + similarity())
 *   3. Trigram similarity on company
 *
 * Results are deduplicated by contact id, ranked by score descending,
 * and truncated to `limit`. All queries run in parallel.
 *
 * Requires pg_trgm extension + GIN indexes (created in migration
 * 20260524040000_search_extensions_and_indexes).
 */
export async function searchContacts(
  userId: string,
  query: string,
  limit: number = DEFAULT_LIMIT,
): Promise<ContactSearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  // Postgres similarity threshold. Set per-transaction via raw SQL since
  // there's no idiomatic Prisma equivalent.
  const threshold = TRIGRAM_THRESHOLD;

  // Embed the query for semantic search. Wrapped so a Voyage failure
  // doesn't break trigram search — the lexical layer still works
  // standalone, and Voyage flakes can happen.
  const semanticPromise = semanticSearch(userId, q, limit).catch((err) => {
    console.error("[searchContacts] semantic layer failed:", err);
    return [] as RawHit[];
  });

  // Run all matchers in parallel.
  const [exactEmail, nameMatches, companyMatches, semanticMatches] = await Promise.all([
    // 1. Exact email match — highest priority. Checks both primary and
    // additional emails.
    prisma.$queryRaw<RawHit[]>(Prisma.sql`
      SELECT id, name, email, company, role, tier::text AS tier,
             EXTRACT(EPOCH FROM "lastInteraction") * 1000 AS "lastInteractionTs",
             "avatarUrl", 1.0::float8 AS score, 'exact_email' AS reason
      FROM "Contact"
      WHERE "userId" = ${userId}
        AND (
          LOWER(email) = LOWER(${q})
          OR LOWER(${q}) = ANY(SELECT LOWER(unnest("additionalEmails")))
        )
      LIMIT ${limit}
    `),

    // 2. Trigram fuzzy name match. word_similarity gives partial-word
    // matches (typing "Marc" matches "Marcus Chen").
    prisma.$queryRaw<RawHit[]>(Prisma.sql`
      SELECT id, name, email, company, role, tier::text AS tier,
             EXTRACT(EPOCH FROM "lastInteraction") * 1000 AS "lastInteractionTs",
             "avatarUrl",
             GREATEST(
               similarity(name, ${q}),
               word_similarity(${q}, name)
             )::float8 AS score,
             'name' AS reason
      FROM "Contact"
      WHERE "userId" = ${userId}
        AND (name % ${q} OR ${q} <% name)
        AND GREATEST(similarity(name, ${q}), word_similarity(${q}, name)) >= ${threshold}
      ORDER BY score DESC
      LIMIT ${limit}
    `),

    // 3. Trigram fuzzy company match. Lower base score than name —
    // matching the company is informative but the name match should
    // win when both fire.
    prisma.$queryRaw<RawHit[]>(Prisma.sql`
      SELECT id, name, email, company, role, tier::text AS tier,
             EXTRACT(EPOCH FROM "lastInteraction") * 1000 AS "lastInteractionTs",
             "avatarUrl",
             (GREATEST(
               similarity(company, ${q}),
               word_similarity(${q}, company)
             ) * 0.6)::float8 AS score,
             'company' AS reason
      FROM "Contact"
      WHERE "userId" = ${userId}
        AND company IS NOT NULL
        AND (company % ${q} OR ${q} <% company)
        AND GREATEST(similarity(company, ${q}), word_similarity(${q}, company)) >= ${threshold}
      ORDER BY score DESC
      LIMIT ${limit}
    `),

    semanticPromise,
  ]);

  // Merge + dedupe by id, keeping the highest-scoring reason per contact.
  const byId = new Map<string, RawHit>();
  for (const row of [...exactEmail, ...nameMatches, ...companyMatches, ...semanticMatches]) {
    const existing = byId.get(row.id);
    if (!existing || row.score > existing.score) {
      byId.set(row.id, row);
    }
  }

  // Sort: score DESC, then tier (INNER_CIRCLE first), then last interaction
  // DESC, then name ASC. Deterministic for ties — query="marc" with 12+
  // tied Marcs should always cut the same one if it exceeds the limit,
  // and Inner Circle / recently-active contacts should win.
  return [...byId.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const tierDelta = tierRank(b.tier) - tierRank(a.tier);
      if (tierDelta !== 0) return tierDelta;
      const aTime = a.lastInteractionTs ?? 0;
      const bTime = b.lastInteractionTs ?? 0;
      if (bTime !== aTime) return bTime - aTime;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map(toHit);
}

function tierRank(tier: string): number {
  switch (tier) {
    case "INNER_CIRCLE": return 3;
    case "PROFESSIONAL": return 2;
    case "ACQUAINTANCE": return 1;
    default: return 0;
  }
}

interface RawHit {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  tier: string;
  avatarUrl: string | null;
  score: number;
  reason: string;
  /** Epoch ms; used only for deterministic tie-breaking. */
  lastInteractionTs?: number | null;
}

/**
 * Embed the query, then run a cosine-similarity scan over Contact.embedding.
 * Skips silently if VOYAGE_API_KEY is unset or no embeddings exist yet —
 * lets the trigram layer run alone during early adoption.
 */
async function semanticSearch(
  userId: string,
  query: string,
  limit: number,
): Promise<RawHit[]> {
  if (!process.env.VOYAGE_API_KEY) return [];

  const { embeddings } = await embedBatch([query], "query");
  if (embeddings.length === 0) return [];

  const literal = formatVectorLiteral(embeddings[0]);

  // 1 - cosine_distance = cosine similarity in pgvector. Score is scaled
  // by SEMANTIC_WEIGHT so that even a perfect (1.0) semantic match
  // ranks below an exact_email hit (always 1.0).
  return prisma.$queryRaw<RawHit[]>(Prisma.sql`
    SELECT id, name, email, company, role, tier::text AS tier,
             EXTRACT(EPOCH FROM "lastInteraction") * 1000 AS "lastInteractionTs",
           "avatarUrl",
           ((1 - ("embedding" <=> ${literal}::vector)) * ${SEMANTIC_WEIGHT})::float8 AS score,
           'semantic' AS reason
    FROM "Contact"
    WHERE "userId" = ${userId}
      AND "embedding" IS NOT NULL
      AND (1 - ("embedding" <=> ${literal}::vector)) >= ${SEMANTIC_MIN_SIMILARITY}
    ORDER BY "embedding" <=> ${literal}::vector ASC
    LIMIT ${limit}
  `);
}

function toHit(row: RawHit): ContactSearchHit {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company: row.company,
    role: row.role,
    tier: row.tier,
    avatarUrl: row.avatarUrl,
    score: row.score,
    matchReason: row.reason,
  };
}
