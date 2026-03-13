import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const status = url.searchParams.get("status"); // DRAFT, SENT, DISCARDED
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 50);

    const where: Record<string, unknown> = { userId: session.user.id };
    if (status && ["DRAFT", "SENT", "DISCARDED"].includes(status)) {
      where.status = status;
    }

    const drafts = await prisma.draft.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
            avatarUrl: true,
          },
        },
      },
    });

    return NextResponse.json({ drafts });
  } catch (error) {
    console.error("[GET /api/drafts]", error);
    return NextResponse.json({ error: "Failed to fetch drafts" }, { status: 500 });
  }
}
