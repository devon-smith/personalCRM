import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RELATIONSHIP_TYPES } from "@/lib/voice/relationship-classifier";
import {
  applyOverrides,
  type LearnedProfile,
  type VoiceOverrides,
} from "@/lib/voice/profile";

const EMPTY_LEARNED: LearnedProfile = {
  byRelationship: {} as LearnedProfile["byRelationship"],
  neverSays: [],
  overallCount: 0,
  generatedAt: 0,
};
const EMPTY_OVERRIDES: VoiceOverrides = { removedPhrases: [], assertions: {} };

/**
 * GET /api/voice/bootstrap
 *
 * Bundles the DB-backed Voice page reads: learned profile, corpus
 * stats, and reference-material summaries. Upload/delete/profile
 * mutations remain on their focused endpoints.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const [profile, grouped, references] = await Promise.all([
    prisma.voiceProfile.findUnique({ where: { userId } }),
    prisma.voiceExample.groupBy({
      by: ["relationshipType"],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.voiceReference.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
      select: {
        id: true,
        filename: true,
        sourceType: true,
        weight: true,
        byteSize: true,
        guidance: true,
        addedAt: true,
      },
    }),
  ]);

  const learned =
    (profile?.learned as unknown as LearnedProfile | null) ?? EMPTY_LEARNED;
  const overrides =
    (profile?.overrides as unknown as VoiceOverrides | null) ?? EMPTY_OVERRIDES;

  const countsByType: Record<string, number> = {};
  for (const rt of RELATIONSHIP_TYPES) countsByType[rt] = 0;
  for (const row of grouped) {
    countsByType[row.relationshipType] = row._count._all;
  }

  return NextResponse.json(
    {
      profile: {
        learned: applyOverrides(learned, overrides),
        overrides,
        indexedEmailCount: profile?.indexedEmailCount ?? 0,
        lastIndexedAt: profile?.lastIndexedAt?.toISOString() ?? null,
        userInstructions: profile?.userInstructions ?? null,
      },
      stats: {
        indexedEmailCount: profile?.indexedEmailCount ?? 0,
        oldestIndexedAt: profile?.oldestIndexedAt?.toISOString() ?? null,
        newestIndexedAt: profile?.newestIndexedAt?.toISOString() ?? null,
        lastIndexedAt: profile?.lastIndexedAt?.toISOString() ?? null,
        countsByType,
      },
      references: references.map((row) => ({
        ...row,
        addedAt: row.addedAt.toISOString(),
      })),
    },
    {
      headers: {
        "Cache-Control": "private, max-age=30, stale-while-revalidate=300",
      },
    },
  );
}
