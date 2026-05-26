/**
 * Voice reference retrieval (M0.x.5).
 *
 * For a given draft intent + recipient relationship type, return the
 * top-K VoiceReferences to inject into the prompt. The retrieval is
 * a two-step rank:
 *
 *   1. Filter by applicableRelationships ("all" OR the recipient's
 *      classified type). The guidance JSON carries this — Haiku
 *      decides at upload whether a reference is universal or
 *      audience-specific.
 *   2. Rank by cosine similarity to the draft-intent embedding,
 *      tied-broken by recency. References without an embedding
 *      (Voyage was down at upload) still qualify via the filter
 *      and rank last.
 *
 * Returns the prompt-ready shape — caller passes it straight into
 * buildVoiceBlock.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import type { VoiceReferenceForPrompt } from "@/lib/voice/draft-prompt";
import type { RelationshipType } from "@/lib/voice/relationship-classifier";

interface GetVoiceReferencesParams {
  prisma: PrismaClient;
  userId: string;
  /** Pre-computed query embedding from the same Voyage call the
   *  voice-example retriever made. Pass null to skip semantic ranking
   *  (falls back to recency). */
  queryEmbeddingLiteral: string | null;
  relationshipType: RelationshipType;
  k?: number;
}

const DEFAULT_K = 3;

interface RawReferenceRow {
  id: string;
  filename: string;
  sourceType: string;
  content: string;
  guidance: unknown;
  weight: number;
  similarity: number | null;
  addedAt: Date;
}

export async function getVoiceReferences(
  params: GetVoiceReferencesParams,
): Promise<VoiceReferenceForPrompt[]> {
  const k = params.k ?? DEFAULT_K;

  // Pull all of the user's references. The expected fleet is small
  // (~5-20 files for power users); ranking in JS is cheaper than a
  // multi-CTE SQL filter on applicableRelationships JSON.
  const rows = await params.prisma.$queryRawUnsafe<RawReferenceRow[]>(
    `
    SELECT
      id, filename, "sourceType", content, guidance, weight, "addedAt",
      ${
        params.queryEmbeddingLiteral
          ? `CASE WHEN embedding IS NULL THEN NULL
                  ELSE (1 - (embedding <=> $2::vector))::float8 END`
          : "NULL::float8"
      } AS similarity
    FROM "VoiceReference"
    WHERE "userId" = $1
    ORDER BY "addedAt" DESC
    `,
    params.userId,
    ...(params.queryEmbeddingLiteral ? [params.queryEmbeddingLiteral] : []),
  );

  if (rows.length === 0) return [];

  // Filter by applicableRelationships.
  const applicable = rows.filter((r) =>
    isApplicable(r.guidance, params.relationshipType),
  );

  // Rank. Composite score = weight * (similarity OR 0.5 baseline).
  // Weight is 1.0 for KB, 0.3 for other refs (spec); keeps the KB
  // ahead even if a same-type sent-mail thread embeds closer.
  const ranked = applicable
    .map((r) => ({
      row: r,
      score:
        r.weight *
        (r.similarity !== null && Number.isFinite(r.similarity)
          ? r.similarity
          : 0.5),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return ranked.map(({ row }) => ({
    id: row.id,
    filename: row.filename,
    sourceType: row.sourceType,
    content: row.content,
    guidance: parseGuidance(row.guidance),
  }));
}

function isApplicable(
  guidance: unknown,
  relationshipType: RelationshipType,
): boolean {
  if (!guidance || typeof guidance !== "object") return true; // permissive default
  const g = guidance as { applicableRelationships?: unknown };
  if (!Array.isArray(g.applicableRelationships)) return true;
  const list = g.applicableRelationships.filter(
    (x): x is string => typeof x === "string",
  );
  if (list.length === 0) return true;
  if (list.includes("all")) return true;
  return list.includes(relationshipType);
}

function parseGuidance(
  raw: unknown,
): VoiceReferenceForPrompt["guidance"] | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  return {
    greetings: asStringArray(g.greetings),
    closings: asStringArray(g.closings),
    signaturePhrases: asStringArray(g.signaturePhrases),
    avoidPhrases: asStringArray(g.avoidPhrases),
    toneNotes: typeof g.toneNotes === "string" ? g.toneNotes : "",
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}
