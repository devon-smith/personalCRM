import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

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
  /** Which signal contributed most: "exact_email" | "name" | "company" */
  matchReason: string;
}

const DEFAULT_LIMIT = 12;
const TRIGRAM_THRESHOLD = 0.3;

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

  // Run all three matchers in parallel.
  const [exactEmail, nameMatches, companyMatches] = await Promise.all([
    // 1. Exact email match — highest priority. Checks both primary and
    // additional emails.
    prisma.$queryRaw<RawHit[]>(Prisma.sql`
      SELECT id, name, email, company, role, tier::text AS tier,
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
  ]);

  // Merge + dedupe by id, keeping the highest-scoring reason per contact.
  const byId = new Map<string, RawHit>();
  for (const row of [...exactEmail, ...nameMatches, ...companyMatches]) {
    const existing = byId.get(row.id);
    if (!existing || row.score > existing.score) {
      byId.set(row.id, row);
    }
  }

  return [...byId.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(toHit);
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
