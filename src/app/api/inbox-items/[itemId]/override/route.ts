import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invalidateInboxCache } from "@/app/api/inbox-items/route";

/**
 * POST /api/inbox-items/:itemId/override
 *
 * Manual classifier override (M0.x.2). Body: { needsResponse: boolean }.
 *
 * Flips InboxItem.needsResponse and records the disagreement as a
 * ClassifierFeedback row so we can tune the system prompt later.
 * If the classifier hasn't run yet (no modelDecision to record), we
 * still flip the field — the feedback row gets modelDecision=null-
 * equivalent (we pass the user's choice as the model's last-known
 * value, which preserves the audit trail meaning "user set this
 * directly without disagreeing with the model").
 *
 * Item is NOT resolved. The user can still mark replied / dismiss
 * via the existing endpoints.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { itemId } = await params;
    const userId = session.user.id;
    const body = await req.json().catch(() => null);
    const userDecision = typeof body?.needsResponse === "boolean" ? body.needsResponse : null;
    if (userDecision === null) {
      return NextResponse.json(
        { error: "needsResponse boolean required in body" },
        { status: 400 },
      );
    }

    const item = await prisma.inboxItem.findUnique({
      where: { id: itemId, userId },
      select: {
        id: true,
        userId: true,
        needsResponse: true,
        responseReason: true,
        responseCategory: true,
        responseConfidence: true,
        messagePreview: true,
      },
    });
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    const previews = Array.isArray(item.messagePreview)
      ? (item.messagePreview as Array<{ summary?: string }>)
      : [];
    const bodyExcerpt = previews[0]?.summary ?? "";

    // Treat null modelDecision as the inverse of userDecision so the
    // feedback row still records a "disagreement" — otherwise items
    // overridden before classification ran would look like the user
    // agreed with a non-existent model output.
    const modelDecision =
      typeof item.needsResponse === "boolean"
        ? item.needsResponse
        : !userDecision;

    await prisma.$transaction([
      prisma.inboxItem.update({
        where: { id: item.id },
        data: {
          needsResponse: userDecision,
          // We keep responseReason/category from the classifier's
          // original output — the user didn't replace it, they
          // overrode the binary decision.
        },
      }),
      prisma.classifierFeedback.create({
        data: {
          userId: item.userId,
          inboxItemId: item.id,
          bodyExcerpt,
          modelDecision,
          userDecision,
          reason: item.responseReason,
          category: item.responseCategory,
          confidence: item.responseConfidence,
        },
      }),
    ]);

    invalidateInboxCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/inbox-items/[itemId]/override]", error);
    return NextResponse.json(
      { error: "Failed to override classifier" },
      { status: 500 },
    );
  }
}
