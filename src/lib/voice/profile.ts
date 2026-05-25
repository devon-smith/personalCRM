/**
 * VoiceProfile aggregation (M6.2).
 *
 * Reads all VoiceExample rows for a user and produces a structured
 * snapshot that the /settings/voice page renders. Manual overrides
 * (removed phrases, asserted patterns) live alongside the learned
 * snapshot and are applied at render time.
 *
 * Shape of `learned`:
 * {
 *   byRelationship: {
 *     former_student: {
 *       count: number,
 *       greetings: [{ type, pct }],
 *       closings: [{ type, pct }],
 *       avgSentenceLen: number,
 *       wordCountMedian: number,
 *       signaturePhrases: [{ phrase, count }],
 *     },
 *     ...
 *   },
 *   neverSays: string[],   // phrases that 0% of relationship types use
 *   overallCount: number,
 * }
 */

import type { PrismaClient } from "@/generated/prisma/client";
import type { RelationshipType } from "./relationship-classifier";
import { RELATIONSHIP_TYPES } from "./relationship-classifier";

export interface LearnedProfile {
  byRelationship: Record<RelationshipType, LearnedRelationshipBucket>;
  /** Phrases that never appear in Jennifer's voice. Extracted from a
   *  small curated list of common stock phrases by comparing observed
   *  vs. absent. */
  neverSays: string[];
  overallCount: number;
  /** When this snapshot was computed (epoch ms). */
  generatedAt: number;
}

export interface LearnedRelationshipBucket {
  count: number;
  greetings: PatternFreq<string>[];
  closings: PatternFreq<string>[];
  avgSentenceLen: number;
  wordCountMedian: number;
  signaturePhrases: PatternFreq<string>[];
}

export interface PatternFreq<T> {
  value: T;
  count: number;
  pct: number; // 0-100, rounded
}

export interface VoiceOverrides {
  /** Phrases Jennifer has removed via the UI. Re-indexing won't bring
   *  these back. */
  removedPhrases: string[];
  /** Asserted patterns the user added by hand (e.g., "I always sign
   *  off with 'with care' to mentees"). Stored as a freeform JSON
   *  blob keyed by relationship type. */
  assertions: Record<string, unknown>;
}

/** Stock phrases that show up everywhere. If none of Jennifer's emails
 *  use any of these, they go into `neverSays` as evidence of voice
 *  by absence. */
const STOCK_NEVER_PROBES = [
  "hope this finds you well",
  "i hope you are well",
  "please find attached",
  "to whom it may concern",
  "as per my last email",
  "circle back",
  "going forward",
  "touch base",
];

const MIN_SIGNATURE_COUNT = 5; // phrase appears in ≥5 emails to count

/**
 * Compute the learned profile from VoiceExample rows and persist it
 * onto VoiceProfile.learned. Called by the worker at the end of each
 * indexing pass, and on-demand from the /api/voice/profile route.
 */
export async function aggregateVoiceProfile(
  prisma: PrismaClient,
  userId: string,
): Promise<LearnedProfile> {
  const examples = await prisma.voiceExample.findMany({
    where: { userId },
    select: {
      relationshipType: true,
      openingType: true,
      closingType: true,
      wordCount: true,
      avgSentenceLen: true,
      signaturePhrases: true,
      sentAt: true,
    },
  });

  const learned = buildLearnedProfile(examples);

  // Compute the index-window stats for the VoiceProfile row.
  const indexedEmailCount = examples.length;
  const dates = examples.map((e) => e.sentAt.getTime());
  const oldest = dates.length ? new Date(Math.min(...dates)) : null;
  const newest = dates.length ? new Date(Math.max(...dates)) : null;

  // Prisma's Json input type rejects arbitrary Record<string, unknown>;
  // round-tripping through JSON.parse(JSON.stringify(...)) coerces it
  // to the InputJsonValue shape Prisma accepts.
  const learnedJson = JSON.parse(JSON.stringify(learned));
  await prisma.voiceProfile.upsert({
    where: { userId },
    create: {
      userId,
      learned: learnedJson,
      overrides: { removedPhrases: [], assertions: {} },
      indexedEmailCount,
      oldestIndexedAt: oldest,
      newestIndexedAt: newest,
      lastIndexedAt: new Date(),
    },
    update: {
      learned: learnedJson,
      indexedEmailCount,
      oldestIndexedAt: oldest,
      newestIndexedAt: newest,
      lastIndexedAt: new Date(),
    },
  });

  return learned;
}

interface RawExample {
  relationshipType: string;
  openingType: string | null;
  closingType: string | null;
  wordCount: number;
  avgSentenceLen: number;
  signaturePhrases: string[];
}

/**
 * Pure aggregation function. Exported separately so it's unit-testable
 * without a Prisma client.
 */
export function buildLearnedProfile(examples: RawExample[]): LearnedProfile {
  const byRelationship = {} as Record<RelationshipType, LearnedRelationshipBucket>;
  for (const rt of RELATIONSHIP_TYPES) {
    byRelationship[rt] = {
      count: 0,
      greetings: [],
      closings: [],
      avgSentenceLen: 0,
      wordCountMedian: 0,
      signaturePhrases: [],
    };
  }

  // Group by relationship type.
  const grouped = new Map<RelationshipType, RawExample[]>();
  for (const ex of examples) {
    const key = (RELATIONSHIP_TYPES.includes(ex.relationshipType as RelationshipType)
      ? ex.relationshipType
      : "unknown") as RelationshipType;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(ex);
  }

  // Aggregate per-bucket.
  for (const [type, bucket] of grouped) {
    const count = bucket.length;
    byRelationship[type] = {
      count,
      greetings: frequencyRanking(bucket.map((b) => b.openingType ?? "none")),
      closings: frequencyRanking(bucket.map((b) => b.closingType ?? "none")),
      avgSentenceLen:
        Math.round(
          (bucket.reduce((s, b) => s + b.avgSentenceLen, 0) / count) * 10,
        ) / 10,
      wordCountMedian: median(bucket.map((b) => b.wordCount)),
      signaturePhrases: signaturePhrases(bucket),
    };
  }

  // Compute "never says" — any stock phrase that doesn't appear in any
  // example's signaturePhrases. Quick scan: union all phrases across
  // all examples, then check stock probes.
  const seen = new Set<string>();
  for (const ex of examples) {
    for (const phrase of ex.signaturePhrases) seen.add(phrase);
  }
  const neverSays = STOCK_NEVER_PROBES.filter((p) => !seen.has(p));

  return {
    byRelationship,
    neverSays,
    overallCount: examples.length,
    generatedAt: Date.now(),
  };
}

// ─── Helpers ────────────────────────────────────────────────

function frequencyRanking<T extends string>(values: T[]): PatternFreq<T>[] {
  const total = values.length;
  if (total === 0) return [];
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([value, count]) => ({
      value,
      count,
      pct: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * Roll up n-grams across the bucket and return any that appear in ≥
 * MIN_SIGNATURE_COUNT emails. Sorted descending by count.
 */
function signaturePhrases(bucket: RawExample[]): PatternFreq<string>[] {
  const counts = new Map<string, number>();
  for (const ex of bucket) {
    // dedupe within an email — multiple occurrences in one email count
    // as one for cross-email frequency purposes.
    const inEmail = new Set(ex.signaturePhrases);
    for (const phrase of inEmail) {
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  const total = bucket.length;
  return Array.from(counts.entries())
    .filter(([, count]) => count >= MIN_SIGNATURE_COUNT)
    .map(([value, count]) => ({
      value,
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25); // cap per-bucket at 25 so the UI doesn't drown
}

/**
 * Apply manual overrides to the learned profile before rendering.
 * Removed phrases drop out of signaturePhrases everywhere; assertions
 * could merge in future, but for now we only honor removals.
 */
export function applyOverrides(
  learned: LearnedProfile,
  overrides: VoiceOverrides,
): LearnedProfile {
  if (overrides.removedPhrases.length === 0) return learned;
  const removed = new Set(overrides.removedPhrases);
  const out: LearnedProfile = {
    ...learned,
    byRelationship: { ...learned.byRelationship },
  };
  for (const [type, bucket] of Object.entries(out.byRelationship)) {
    out.byRelationship[type as RelationshipType] = {
      ...bucket,
      signaturePhrases: bucket.signaturePhrases.filter(
        (p) => !removed.has(p.value),
      ),
    };
  }
  return out;
}
