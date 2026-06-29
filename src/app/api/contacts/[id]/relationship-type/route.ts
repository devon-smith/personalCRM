import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { privateCacheHeaders } from "@/lib/http/cache";
import { prisma } from "@/lib/prisma";
import { classifyRecipient } from "@/lib/voice/relationship-classifier";

const READ_CACHE_HEADERS = privateCacheHeaders(300, 600);

function relationshipTypeResponse(relationshipType: string | null) {
  return NextResponse.json(
    { relationshipType },
    { headers: READ_CACHE_HEADERS },
  );
}

/**
 * GET /api/contacts/:id/relationship-type
 *
 * Returns the inferred relationship type for a given contact. Used by
 * the draft modal (M6.4) to populate the "Drafting as:" pill so
 * Jennifer can confirm or override before generation.
 *
 * Cheap-side guarantee: the classifier's three-layer cascade
 * short-circuits on circle name + tier mapping before it would hit
 * Claude Haiku, so this endpoint is fast for most contacts. Even when
 * Haiku fires, the in-process cache amortizes across draft sessions.
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
    select: { email: true },
  });
  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  if (!contact.email) {
    // No email → no recipient lookup → no relationship classification.
    // Return null rather than 400; the draft modal handles this by
    // hiding the pill.
    return relationshipTypeResponse(null);
  }

  const relationshipType = await classifyRecipient({
    prisma,
    userId: session.user.id,
    recipientEmail: contact.email,
  });

  return relationshipTypeResponse(relationshipType);
}
