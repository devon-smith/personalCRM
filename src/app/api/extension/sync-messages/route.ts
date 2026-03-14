import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface SyncMessagesBody {
  conversationWith: {
    name: string;
    linkedinUrl: string | null;
  };
  messages: Array<{
    text: string;
    timestamp: string;
    isFromMe: boolean;
    senderName: string;
  }>;
}

/**
 * POST /api/extension/sync-messages
 * Receives LinkedIn DM conversations and creates Interaction records.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const body = (await request.json()) as SyncMessagesBody;

    if (!body.conversationWith?.name || !body.messages?.length) {
      return NextResponse.json(
        { error: "conversationWith and messages are required" },
        { status: 400 },
      );
    }

    // Find the contact by LinkedIn URL or name
    let contact = body.conversationWith.linkedinUrl
      ? await prisma.contact.findFirst({
          where: {
            userId,
            linkedinUrl: {
              startsWith: body.conversationWith.linkedinUrl.replace(/\/+$/, ""),
            },
          },
          select: { id: true, name: true },
        })
      : null;

    if (!contact) {
      contact = await prisma.contact.findFirst({
        where: { userId, name: body.conversationWith.name },
        select: { id: true, name: true },
      });
    }

    if (!contact) {
      return NextResponse.json({
        synced: 0,
        skipped: body.messages.length,
        message: `Contact "${body.conversationWith.name}" not found in CRM`,
      });
    }

    // Create interactions, dedup by sourceId
    let synced = 0;
    let skipped = 0;

    for (const msg of body.messages) {
      const timestamp = new Date(msg.timestamp);
      const sourceId = `linkedin-msg:${contact.id}:${timestamp.getTime()}`;

      const existing = await prisma.interaction.findFirst({
        where: { userId, sourceId },
      });

      if (existing) {
        skipped++;
        continue;
      }

      await prisma.interaction.create({
        data: {
          userId,
          contactId: contact.id,
          type: "MESSAGE",
          direction: msg.isFromMe ? "OUTBOUND" : "INBOUND",
          channel: "linkedin",
          summary: msg.text.slice(0, 500),
          occurredAt: timestamp,
          sourceId,
        },
      });
      synced++;
    }

    // Update lastInteraction
    if (synced > 0) {
      const latest = await prisma.interaction.findFirst({
        where: { contactId: contact.id, userId },
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true },
      });
      if (latest) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { lastInteraction: latest.occurredAt },
        });
      }
    }

    return NextResponse.json({
      synced,
      skipped,
      message: `Synced ${synced} message(s) for ${contact.name}`,
    });
  } catch (error) {
    console.error("[POST /api/extension/sync-messages]", error);
    return NextResponse.json(
      { error: "Failed to sync messages" },
      { status: 500 },
    );
  }
}
