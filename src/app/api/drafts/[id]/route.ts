import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
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
    const { action, content } = body as {
      action?: "send" | "discard" | "edit";
      content?: string;
    };

    // Verify ownership
    const existing = await prisma.draft.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (action === "send") {
      // Use raw SQL for PrismaPg compatibility
      await prisma.$executeRaw`
        UPDATE "Draft"
        SET "status" = 'SENT'::"DraftStatus", "sentAt" = NOW(), "updatedAt" = NOW()
        WHERE "id" = ${id} AND "userId" = ${session.user.id}
      `;

      // Log as interaction
      await prisma.interaction.create({
        data: {
          userId: session.user.id,
          contactId: existing.contactId,
          type: "EMAIL",
          direction: "OUTBOUND",
          subject: existing.subjectLine,
          summary: `Sent draft: ${existing.content.slice(0, 100)}`,
          occurredAt: new Date(),
        },
      });

      // Update contact lastInteraction
      await prisma.$executeRaw`
        UPDATE "Contact"
        SET "lastInteraction" = NOW(), "updatedAt" = NOW()
        WHERE "id" = ${existing.contactId}
      `;

      return NextResponse.json({ success: true, status: "SENT" });
    }

    if (action === "discard") {
      await prisma.$executeRaw`
        UPDATE "Draft"
        SET "status" = 'DISCARDED'::"DraftStatus", "updatedAt" = NOW()
        WHERE "id" = ${id} AND "userId" = ${session.user.id}
      `;
      return NextResponse.json({ success: true, status: "DISCARDED" });
    }

    if (action === "edit" && typeof content === "string" && content.trim()) {
      await prisma.$executeRaw`
        UPDATE "Draft"
        SET "content" = ${content.trim()}, "updatedAt" = NOW()
        WHERE "id" = ${id} AND "userId" = ${session.user.id}
      `;
      return NextResponse.json({ success: true, content: content.trim() });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("[PATCH /api/drafts/[id]]", error);
    return NextResponse.json({ error: "Failed to update draft" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const rowsDeleted = await prisma.$executeRaw`
      DELETE FROM "Draft"
      WHERE "id" = ${id} AND "userId" = ${session.user.id}
    `;

    if (rowsDeleted === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/drafts/[id]]", error);
    return NextResponse.json({ error: "Failed to delete draft" }, { status: 500 });
  }
}
