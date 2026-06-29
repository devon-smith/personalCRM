import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { privateCacheHeaders } from "@/lib/http/cache";
import { prisma } from "@/lib/prisma";
import { findNeighbors } from "@/lib/intelligence/graph-traverse";

const READ_CACHE_HEADERS = privateCacheHeaders(30, 300);

/**
 * GET /api/contacts/:id/intelligence
 *
 * Bundles the DB-backed contact intelligence surfaces used in the
 * contact detail panel. This avoids three separate auth checks and
 * request round trips for profile, memory, and network data.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const contact = await prisma.contact.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      profile: {
        select: {
          expertiseAreas: true,
          communicationStyle: true,
          geographicContext: true,
          personalitySignals: true,
          relationshipStage: true,
          rawAttributes: true,
          interactionsAtGeneration: true,
          generatedAt: true,
        },
      },
      memory: {
        select: {
          discussedTopics: true,
          theyMentioned: true,
          openThreads: true,
          personalContext: true,
          recurringThemes: true,
          synthesizedAt: true,
        },
      },
    },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const neighbors = await findNeighbors({
    prisma,
    userId: session.user.id,
    contactId: id,
  });

  return NextResponse.json(
    {
      profile: contact.profile,
      memory: contact.memory,
      neighbors,
    },
    { headers: READ_CACHE_HEADERS },
  );
}
