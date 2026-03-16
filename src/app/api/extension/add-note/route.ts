import { NextResponse } from "next/server";
import { authExtension } from "@/lib/extension-auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/extension/add-note
 * Quick note from the sidebar without opening the CRM.
 */
export async function POST(request: Request) {
  try {
    const authResult = await authExtension(request);
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.userId;

    const body = (await request.json()) as { contactId: string; note: string };

    if (!body.contactId || !body.note?.trim()) {
      return NextResponse.json(
        { error: "contactId and note are required" },
        { status: 400 },
      );
    }

    // Verify contact ownership
    const contact = await prisma.contact.findFirst({
      where: { id: body.contactId, userId },
      select: { id: true, name: true },
    });
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    await prisma.interaction.create({
      data: {
        userId,
        contactId: contact.id,
        type: "NOTE",
        direction: "OUTBOUND",
        channel: "linkedin",
        summary: body.note.trim().slice(0, 2000),
        occurredAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      message: `Note added for ${contact.name}`,
    });
  } catch (error) {
    console.error("[POST /api/extension/add-note]", error);
    return NextResponse.json(
      { error: "Failed to add note" },
      { status: 500 },
    );
  }
}
