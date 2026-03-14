import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { contactId } = await params;
    const body = await req.json();
    const { action, interactionId } = body as {
      action: "dismiss" | "respond";
      interactionId?: string;
    };

    if (!["dismiss", "respond"].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'dismiss' or 'respond'" },
        { status: 400 },
      );
    }

    // If an interactionId is provided, operate on that specific interaction
    // Otherwise, operate on the contact level
    const targetId = interactionId ?? contactId;

    if (action === "dismiss" && interactionId) {
      const rowsUpdated = await prisma.$executeRaw`
        UPDATE "Interaction"
        SET "dismissedAt" = NOW()
        WHERE "id" = ${targetId} AND "userId" = ${session.user.id}
      `;

      if (rowsUpdated === 0) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      return NextResponse.json({ success: true, action: "dismissed" });
    }

    if (action === "respond") {
      const interaction = interactionId
        ? await prisma.interaction.findFirst({
            where: { id: interactionId, userId: session.user.id },
            select: { contactId: true, type: true, subject: true },
          })
        : await prisma.interaction.findFirst({
            where: { contactId, userId: session.user.id, direction: "INBOUND" },
            orderBy: { occurredAt: "desc" },
            select: { contactId: true, type: true, subject: true },
          });

      if (!interaction) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      // Dismiss the original if we have a specific interaction
      if (interactionId) {
        await prisma.$executeRaw`
          UPDATE "Interaction"
          SET "dismissedAt" = NOW()
          WHERE "id" = ${interactionId} AND "userId" = ${session.user.id}
        `;
      }

      // Log a reply interaction
      await prisma.interaction.create({
        data: {
          userId: session.user.id,
          contactId: interaction.contactId,
          type: interaction.type,
          direction: "OUTBOUND",
          subject: interaction.subject,
          summary: "Responded (marked via CRM)",
          occurredAt: new Date(),
        },
      });

      // Update contact lastInteraction
      await prisma.$executeRaw`
        UPDATE "Contact"
        SET "lastInteraction" = NOW(), "updatedAt" = NOW()
        WHERE "id" = ${interaction.contactId}
      `;

      return NextResponse.json({ success: true, action: "responded" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("[POST /api/needs-response/[contactId]/action]", error);
    return NextResponse.json(
      { error: "Failed to process action" },
      { status: 500 },
    );
  }
}
