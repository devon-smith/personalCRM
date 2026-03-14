import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface LogActivityBody {
  contactId: string | null;
  linkedinUrl: string;
  activityType: "profile_view" | "connection_sent" | "connection_accepted";
}

const ACTIVITY_SUMMARIES: Record<string, string> = {
  profile_view: "Viewed LinkedIn profile",
  connection_sent: "Sent LinkedIn connection request",
  connection_accepted: "LinkedIn connection accepted",
};

/**
 * POST /api/extension/log-activity
 * Log a profile view or connection request.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const body = (await request.json()) as LogActivityBody;

    if (!body.linkedinUrl || !body.activityType) {
      return NextResponse.json(
        { error: "linkedinUrl and activityType are required" },
        { status: 400 },
      );
    }

    // Resolve contact
    let contactId = body.contactId;
    if (!contactId) {
      const normalized = body.linkedinUrl.replace(/\/+$/, "");
      const contact = await prisma.contact.findFirst({
        where: { userId, linkedinUrl: { startsWith: normalized } },
        select: { id: true },
      });
      contactId = contact?.id ?? null;
    }

    if (!contactId) {
      return NextResponse.json({
        logged: false,
        message: "Contact not found in CRM",
      });
    }

    // Verify ownership
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, userId },
      select: { id: true },
    });
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    // Dedup: don't log the same activity type for the same contact within 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const summary = ACTIVITY_SUMMARIES[body.activityType] ?? body.activityType;

    const recent = await prisma.interaction.findFirst({
      where: {
        userId,
        contactId,
        channel: "linkedin",
        summary,
        occurredAt: { gte: oneHourAgo },
      },
    });

    if (recent) {
      return NextResponse.json({
        logged: false,
        message: "Activity already logged recently",
      });
    }

    await prisma.interaction.create({
      data: {
        userId,
        contactId,
        type: "NOTE",
        direction: "OUTBOUND",
        channel: "linkedin",
        summary,
        occurredAt: new Date(),
        sourceId: `linkedin-activity:${contactId}:${Date.now()}`,
      },
    });

    return NextResponse.json({
      logged: true,
      message: `Logged: ${summary}`,
    });
  } catch (error) {
    console.error("[POST /api/extension/log-activity]", error);
    return NextResponse.json(
      { error: "Failed to log activity" },
      { status: 500 },
    );
  }
}
