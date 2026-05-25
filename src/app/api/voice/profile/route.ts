import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { applyOverrides, type LearnedProfile, type VoiceOverrides } from "@/lib/voice/profile";

/**
 * GET /api/voice/profile
 *
 * Returns the learned voice fingerprint with manual overrides applied,
 * ready to render in the /settings/voice page. Empty `learned` + empty
 * `overrides` is returned when no indexing pass has run yet — caller
 * shows the empty-state CTA.
 *
 * PATCH /api/voice/profile
 *
 * Updates manual overrides. Body shape:
 *   { removedPhrases?: string[], assertions?: Record<string, unknown> }
 * Removed phrases are merged additively unless `replaceRemovedPhrases:
 * true` is set.
 */

const EMPTY_LEARNED: LearnedProfile = {
  byRelationship: {} as LearnedProfile["byRelationship"],
  neverSays: [],
  overallCount: 0,
  generatedAt: 0,
};
const EMPTY_OVERRIDES: VoiceOverrides = { removedPhrases: [], assertions: {} };

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.voiceProfile.findUnique({
    where: { userId: session.user.id },
  });

  const learned =
    (profile?.learned as unknown as LearnedProfile | null) ?? EMPTY_LEARNED;
  const overrides =
    (profile?.overrides as unknown as VoiceOverrides | null) ?? EMPTY_OVERRIDES;
  const merged = applyOverrides(learned, overrides);

  return NextResponse.json({
    learned: merged,
    overrides,
    indexedEmailCount: profile?.indexedEmailCount ?? 0,
    lastIndexedAt: profile?.lastIndexedAt?.toISOString() ?? null,
  });
}

interface PatchBody {
  removedPhrases?: string[];
  assertions?: Record<string, unknown>;
  /** If true, replace removedPhrases wholesale; otherwise merge. */
  replaceRemovedPhrases?: boolean;
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as PatchBody;

  const existing = await prisma.voiceProfile.findUnique({
    where: { userId: session.user.id },
  });
  const currentOverrides =
    (existing?.overrides as unknown as VoiceOverrides | null) ?? EMPTY_OVERRIDES;

  const nextRemoved = body.replaceRemovedPhrases
    ? body.removedPhrases ?? []
    : Array.from(
        new Set([
          ...currentOverrides.removedPhrases,
          ...(body.removedPhrases ?? []),
        ]),
      );

  const nextOverrides: VoiceOverrides = {
    removedPhrases: nextRemoved,
    assertions: body.assertions ?? currentOverrides.assertions,
  };

  const overridesJson = JSON.parse(JSON.stringify(nextOverrides));
  await prisma.voiceProfile.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      learned: {},
      overrides: overridesJson,
    },
    update: {
      overrides: overridesJson,
    },
  });

  return NextResponse.json({ ok: true, overrides: nextOverrides });
}
