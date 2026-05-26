import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/contacts/:id/memory
 *
 * Returns the synthesized ContactMemory for a contact (M8.1).
 * Returns null when no memory exists yet — daily cron only
 * synthesizes contacts with ≥5 new interactions.
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
  return NextResponse.json({ memory: contact.memory });
}
