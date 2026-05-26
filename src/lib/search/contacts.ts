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
// Trigram similarity floor. Lower for short queries (3-4 chars) since
// a 1-letter typo on a 4-letter name only overlaps 1 of 5 trigrams
// (~0.2). The default threshold catches longer, less ambiguous typos
// without flooding short queries with false positives.
const TRIGRAM_THRESHOLD_DEFAULT = 0.3;
const TRIGRAM_THRESHOLD_SHORT = 0.2;
const SHORT_QUERY_THRESHOLD_LEN = 5;
const SEMANTIC_MIN_SIMILARITY = 0.55;
const SEMANTIC_WEIGHT = 0.85;

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

  // Postgres similarity threshold.
  const threshold =
    q.length < SHORT_QUERY_THRESHOLD_LEN
      ? TRIGRAM_THRESHOLD_SHORT
      : TRIGRAM_THRESHOLD_DEFAULT;

  // For short queries (≤6 chars), generate adjacent-swap transposition
  // variants and let the matcher take the MAX similarity across all of
  // them. This handles the "mrac" → "Marc" typo case that pure trigram
  // similarity ranks poorly because "Mracoba" shares more raw trigrams
  // than "Marc Beban" does. Variant search treats a single swap as a
  // first-class match. For long queries this is just [q] — no expansion.
  const nameVariants =
    q.length <= 6 ? generateTranspositionVariants(q) : [q];

  // For email-shaped queries that DON'T exactly match a stored email,
  // also run the name-trigram matcher against the email's local-part
  // (with separators normalized to spaces). Typing
  // "marc.beban@gmail.com" should still surface Marc Beban even if
  // his stored email is different.
  const nameProbe = q.includes("@") ? emailLocalToNameProbe(q) : null;

  // Embed the query for semantic search. Wrapped so a Voyage failure
  // doesn't break trigram search — the lexical layer still works
  // standalone, and Voyage flakes can happen.
  const semanticPromise = semanticSearch(userId, q, limit).catch((err) => {
    console.error("[searchContacts] semantic layer failed:", err);
    return [] as RawHit[];
  });

  // Run all matchers in parallel.
  const [exactEmail, nameMatches, companyMatches, emailNameFallback, semanticMatches] = await Promise.all([
    // 1. Email match. Exact match wins at score 1.0; substring contain
    // match (the query appears anywhere in the email) gets 0.9 — covers
    // typing "marc.beban" expecting to land on marc.beban@gmail.com when
    // the user can't remember the exact domain. Requires 4+ chars to
    // avoid a flood of substring hits on short queries. Checks both
    // primary and additionalEmails.
    prisma.$queryRaw<RawHit[]>(Prisma.sql`
      SELECT id, name, email, company, role, tier::text AS tier,
             EXTRACT(EPOCH FROM "lastInteraction") * 1000 AS "lastInteractionTs",
             "avatarUrl",
             CASE
               WHEN LOWER(email) = LOWER(${q})
                 OR LOWER(${q}) = ANY(SELECT LOWER(unnest("additionalEmails"))) THEN 1.0
               ELSE 0.9
             END::float8 AS score,
             'exact_email' AS reason
      FROM "Contact"
      WHERE "userId" = ${userId}
        AND "isNoise" = FALSE
        AND LENGTH(${q}) >= 4
        AND (
          LOWER(email) = LOWER(${q})
          OR LOWER(email) LIKE '%' || LOWER(${q}) || '%'
          OR LOWER(${q}) = ANY(SELECT LOWER(unnest("additionalEmails")))
          OR EXISTS (
            SELECT 1 FROM UNNEST("additionalEmails") AS ae
            WHERE LOWER(ae) LIKE '%' || LOWER(${q}) || '%'
          )
        )
      LIMIT ${limit}
    `),

    // 2. Trigram fuzzy name match. CROSS JOINs against the variant
    // array so each row's score is the MAX similarity over all
    // candidates — gives transpositions like "mrac"→"marc" a real
    // shot at the top. No `%` index-gate (session threshold can't
    // be set per-query); seq scan is acceptable at single-user scale.
    prisma.$queryRaw<RawHit[]>(Prisma.sql`
      SELECT c.id, c.name, c.email, c.company, c.role, c.tier::text AS tier,
             EXTRACT(EPOCH FROM c."lastInteraction") * 1000 AS "lastInteractionTs",
             c."avatarUrl",
             MAX(GREATEST(
               similarity(c.name, v),
               word_similarity(v, c.name)
             ))::float8 AS score,
             'name' AS reason
      FROM "Contact" c
      CROSS JOIN UNNEST(${nameVariants}::text[]) AS v
      WHERE c."userId" = ${userId}
        AND c."isNoise" = FALSE
      GROUP BY c.id, c.name, c.email, c.company, c.role, c.tier,
               c."avatarUrl", c."lastInteraction"
      HAVING MAX(GREATEST(
               similarity(c.name, v),
               word_similarity(v, c.name)
             )) >= ${threshold}
      ORDER BY score DESC
      LIMIT ${limit}
    `),

    // 3. Trigram fuzzy company match. Same variant-MAX pattern as
    // name; scored 0.6x so name match wins on ties.
    prisma.$queryRaw<RawHit[]>(Prisma.sql`
      SELECT c.id, c.name, c.email, c.company, c.role, c.tier::text AS tier,
             EXTRACT(EPOCH FROM c."lastInteraction") * 1000 AS "lastInteractionTs",
             c."avatarUrl",
             (MAX(GREATEST(
               similarity(c.company, v),
               word_similarity(v, c.company)
             )) * 0.6)::float8 AS score,
             'company' AS reason
      FROM "Contact" c
      CROSS JOIN UNNEST(${nameVariants}::text[]) AS v
      WHERE c."userId" = ${userId}
        AND c."isNoise" = FALSE
        AND c.company IS NOT NULL
      GROUP BY c.id, c.name, c.email, c.company, c.role, c.tier,
               c."avatarUrl", c."lastInteraction"
      HAVING MAX(GREATEST(
               similarity(c.company, v),
               word_similarity(v, c.company)
             )) >= ${threshold}
      ORDER BY score DESC
      LIMIT ${limit}
    `),

    // 4. Email-as-name fallback: when query contains @ and didn't
    // hit any direct email match, try the trigram matcher with the
    // email's local-part (e.g. "marc.beban@x.com" → search "marc beban"
    // as a name). Drops by 0.7x so a real name match still wins.
    nameProbe
      ? prisma.$queryRaw<RawHit[]>(Prisma.sql`
          SELECT id, name, email, company, role, tier::text AS tier,
                 EXTRACT(EPOCH FROM "lastInteraction") * 1000 AS "lastInteractionTs",
                 "avatarUrl",
                 (GREATEST(
                   similarity(name, ${nameProbe}),
                   word_similarity(${nameProbe}, name)
                 ) * 0.7)::float8 AS score,
                 'name' AS reason
          FROM "Contact"
          WHERE "userId" = ${userId}
            AND "isNoise" = FALSE
            AND GREATEST(
              similarity(name, ${nameProbe}),
              word_similarity(${nameProbe}, name)
            ) >= ${TRIGRAM_THRESHOLD_DEFAULT}
          ORDER BY score DESC
          LIMIT ${limit}
        `)
      : Promise.resolve([] as RawHit[]),

    semanticPromise,
  ]);

  // Merge + dedupe by id, keeping the highest-scoring reason per contact.
  const byId = new Map<string, RawHit>();
  for (const row of [...exactEmail, ...nameMatches, ...companyMatches, ...emailNameFallback, ...semanticMatches]) {
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

/**
 * Generate the query plus every adjacent-character swap. For "mrac"
 * returns ["mrac", "rmac", "marc", "mrca"]. Used by the trigram name
 * matcher to handle transposition typos that pure trigram similarity
 * doesn't rank well — the swapped variant matches the target directly
 * and floats to the top via MAX-over-variants.
 *
 * No-op for short (≤1 char) or long (>6 char) inputs; longer typos
 * are typically not transpositions and the variant explosion isn't
 * worth the cost.
 */
export function generateTranspositionVariants(q: string): string[] {
  if (q.length <= 1) return [q];
  const variants = new Set<string>([q]);
  for (let i = 0; i < q.length - 1; i++) {
    const arr = q.split("");
    [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    variants.add(arr.join(""));
  }
  return [...variants];
}

/**
 * Convert an email-shaped query to a name-probe: take the local-part
 * (before @), drop +tags, normalize . _ - to spaces, trim. Returns
 * null when the local part is short / opaque / numeric-only (where a
 * name match would just produce noise).
 *
 *   "marc.beban@gmail.com"           → "marc beban"
 *   "marc.beban+work@gmail.com"      → "marc beban"
 *   "j.doe-smith@x.com"              → "j doe smith"
 *   "abc123@example.com"             → null (no real signal)
 */
export function emailLocalToNameProbe(s: string): string | null {
  const at = s.indexOf("@");
  if (at <= 0) return null;
  let local = s.slice(0, at);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  const normalized = local.replace(/[._\-]+/g, " ").trim();
  if (normalized.length < 3) return null;
  // Require at least one alphabetic word of 2+ chars; rejects "12345"
  // and similar opaque locals.
  if (!/[A-Za-zÀ-ɏ]{2,}/.test(normalized)) return null;
  return normalized;
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
      AND "isNoise" = FALSE
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
