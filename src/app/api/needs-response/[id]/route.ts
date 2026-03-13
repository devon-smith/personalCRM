import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { action } = body as { action: "dismiss" | "respond" };

    if (!["dismiss", "respond"].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'dismiss' or 'respond'" },
        { status: 400 },
      );
    }

    if (action === "dismiss") {
      // Mark the interaction as dismissed using raw SQL for PrismaPg compat
      const rowsUpdated = await prisma.$executeRaw`
        UPDATE "Interaction"
        SET "dismissedAt" = NOW()
        WHERE "id" = ${id} AND "userId" = ${session.user.id}
      `;

      if (rowsUpdated === 0) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      return NextResponse.json({ success: true, action: "dismissed" });
    }

    if (action === "respond") {
      // Mark as responded — dismiss the inbound + log outbound interaction
      const interaction = await prisma.interaction.findFirst({
        where: { id, userId: session.user.id },
        select: { contactId: true, type: true, subject: true },
      });

      if (!interaction) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      // Dismiss the original
      await prisma.$executeRaw`
        UPDATE "Interaction"
        SET "dismissedAt" = NOW()
        WHERE "id" = ${id} AND "userId" = ${session.user.id}
      `;

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
    console.error("[POST /api/needs-response/[id]]", error);
    return NextResponse.json(
      { error: "Failed to process action" },
      { status: 500 },
    );
  }
}
