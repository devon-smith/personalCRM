import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/contacts/:id/profile
 *
 * Returns the structured ContactProfile populated by M7.1's
 * contact-attribute-extraction worker. Returns null when no profile
 * exists yet (the worker only profiles contacts with ≥5 interactions
 * and runs on a daily cron).
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

  // Verify ownership before returning profile (the FK doesn't enforce
  // user scoping on Contact since the relation is via contactId only).
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
    },
  });
  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  return NextResponse.json({ profile: contact.profile });
}
