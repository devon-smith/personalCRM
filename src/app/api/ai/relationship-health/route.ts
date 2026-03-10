import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeRelationshipHealth } from "@/lib/ai-insights";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { contactId } = await req.json();
  if (!contactId) {
    return NextResponse.json(
      { error: "contactId is required" },
      { status: 400 }
    );
  }

  // Check for fresh cached insight (< 24 hours)
  const cached = await prisma.relationshipInsight.findUnique({
    where: { contactId },
  });

  if (cached) {
    const ageHours =
      (Date.now() - new Date(cached.computedAt).getTime()) / (1000 * 60 * 60);
    if (ageHours < 24) {
      return NextResponse.json({
        healthScore: cached.healthScore,
        healthLabel: cached.healthLabel,
        summary: cached.summary,
        actions: cached.actions,
        cached: true,
      });
    }
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId: session.user.id },
    include: {
      interactions: {
        orderBy: { occurredAt: "desc" },
        take: 10,
      },
    },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const result = await computeRelationshipHealth(contact);

  // Upsert cached insight
  await prisma.relationshipInsight.upsert({
    where: { contactId },
    create: {
      contactId,
      userId: session.user.id,
      healthScore: result.healthScore,
      healthLabel: result.healthLabel,
      summary: result.summary,
      actions: result.actions,
    },
    update: {
      healthScore: result.healthScore,
      healthLabel: result.healthLabel,
      summary: result.summary,
      actions: result.actions,
      computedAt: new Date(),
    },
  });

  return NextResponse.json({ ...result, cached: false });
}

// Batch endpoint: compute health for all contacts
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Return all cached insights for this user
  const insights = await prisma.relationshipInsight.findMany({
    where: { userId: session.user.id },
    include: {
      contact: {
        select: { id: true, name: true, company: true, tier: true, avatarUrl: true },
      },
    },
    orderBy: { healthScore: "asc" },
  });

  return NextResponse.json({ insights });
}
