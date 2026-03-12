import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "30"), 100);
    const filter = searchParams.get("filter") ?? "all";

    const where: Prisma.EmailMessageWhereInput = {
      userId: session.user.id,
      ...(filter === "matched" && { contactId: { not: null } }),
      ...(filter === "unmatched" && { contactId: null }),
    };

    const messages = await prisma.emailMessage.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take: limit,
      select: {
        id: true,
        gmailId: true,
        threadId: true,
        fromEmail: true,
        fromName: true,
        toEmail: true,
        subject: true,
        snippet: true,
        direction: true,
        occurredAt: true,
        contactId: true,
        contactName: true,
        isRead: true,
      },
    });

    const total = await prisma.emailMessage.count({ where });

    return NextResponse.json({ messages, total });
  } catch (error) {
    console.error("[GET /api/inbox]", error);
    return NextResponse.json({ error: "Failed to fetch inbox" }, { status: 500 });
  }
}
