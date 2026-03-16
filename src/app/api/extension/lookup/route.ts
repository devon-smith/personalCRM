import { NextResponse, type NextRequest } from "next/server";
import { authExtension } from "@/lib/extension-auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/extension/lookup?linkedin_url={url}
 * Returns full contact card data for the sidebar overlay.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authExtension(request);
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.userId;

    const linkedinUrl = request.nextUrl.searchParams.get("linkedin_url");
    if (!linkedinUrl) {
      return NextResponse.json(
        { error: "linkedin_url param required" },
        { status: 400 },
      );
    }

    // Normalize and try both with/without trailing slash
    const normalized = linkedinUrl.replace(/\/+$/, "");

    const contact = await prisma.contact.findFirst({
      where: {
        userId,
        linkedinUrl: { startsWith: normalized },
      },
      include: {
        circles: {
          include: { circle: { select: { name: true, color: true } } },
        },
        relationshipInsight: {
          select: { healthScore: true, healthLabel: true },
        },
        _count: { select: { interactions: true } },
      },
    });

    if (!contact) {
      return NextResponse.json({ found: false, contact: null });
    }

    // Get recent interactions
    const recentInteractions = await prisma.interaction.findMany({
      where: { contactId: contact.id, userId },
      orderBy: { occurredAt: "desc" },
      take: 5,
      select: {
        type: true,
        direction: true,
        summary: true,
        occurredAt: true,
        channel: true,
      },
    });

    // Compute follow-up status
    const daysSinceLastInteraction = contact.lastInteraction
      ? Math.floor(
          (Date.now() - contact.lastInteraction.getTime()) / (1000 * 60 * 60 * 24),
        )
      : null;

    const needsFollowUp =
      contact.followUpDays != null &&
      daysSinceLastInteraction != null &&
      daysSinceLastInteraction > contact.followUpDays;

    const followUpOverdueDays =
      needsFollowUp && contact.followUpDays != null && daysSinceLastInteraction != null
        ? daysSinceLastInteraction - contact.followUpDays
        : null;

    return NextResponse.json({
      found: true,
      contact: {
        id: contact.id,
        name: contact.name,
        company: contact.company,
        role: contact.role,
        tier: contact.tier,
        email: contact.email,
        phone: contact.phone,
        avatarUrl: contact.avatarUrl,
        lastInteraction: contact.lastInteraction?.toISOString() ?? null,
        daysSinceLastInteraction,
        circles: contact.circles.map((cc) => ({
          name: cc.circle.name,
          color: cc.circle.color,
        })),
        tags: contact.tags,
        notes: contact.notes,
        interactionCount: contact._count.interactions,
        needsFollowUp,
        followUpOverdueDays,
        recentInteractions: recentInteractions.map((ix) => ({
          type: ix.type,
          direction: ix.direction,
          summary: ix.summary?.slice(0, 200) ?? null,
          occurredAt: ix.occurredAt.toISOString(),
          channel: ix.channel,
        })),
        healthScore: contact.relationshipInsight?.healthScore ?? null,
        healthLabel: contact.relationshipInsight?.healthLabel ?? null,
      },
    });
  } catch (error) {
    console.error("[GET /api/extension/lookup]", error);
    return NextResponse.json(
      { error: "Failed to lookup contact" },
      { status: 500 },
    );
  }
}
