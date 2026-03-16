import { NextResponse } from "next/server";
import { authExtension } from "@/lib/extension-auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/extension/add-tags
 * Add tags from the sidebar (merges with existing).
 */
export async function POST(request: Request) {
  try {
    const authResult = await authExtension(request);
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.userId;

    const body = (await request.json()) as { contactId: string; tags: string[] };

    if (!body.contactId || !Array.isArray(body.tags) || body.tags.length === 0) {
      return NextResponse.json(
        { error: "contactId and tags[] are required" },
        { status: 400 },
      );
    }

    const contact = await prisma.contact.findFirst({
      where: { id: body.contactId, userId },
      select: { id: true, name: true, tags: true },
    });
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    // Merge tags (case-insensitive dedup)
    const existingLower = new Set(contact.tags.map((t) => t.toLowerCase()));
    const newTags = body.tags
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && !existingLower.has(t.toLowerCase()));

    const mergedTags = [...contact.tags, ...newTags];

    await prisma.contact.update({
      where: { id: contact.id },
      data: { tags: mergedTags },
    });

    return NextResponse.json({
      success: true,
      tags: mergedTags,
      added: newTags,
      message: newTags.length > 0
        ? `Added ${newTags.length} tag(s) to ${contact.name}`
        : "No new tags to add",
    });
  } catch (error) {
    console.error("[POST /api/extension/add-tags]", error);
    return NextResponse.json(
      { error: "Failed to add tags" },
      { status: 500 },
    );
  }
}
