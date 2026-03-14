import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { detectNeedsResponse } from "@/lib/needs-response";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Load snoozed contacts
    const now = new Date();
    const snoozed = await prisma.snoozedContact.findMany({
      where: { userId, until: { gt: now } },
      select: { contactId: true },
    });
    const snoozedIds = new Set(snoozed.map((s) => s.contactId));

    const result = await detectNeedsResponse(userId, snoozedIds);

    return NextResponse.json(result);
  } catch (error) {
    console.error("[GET /api/needs-response]", error);
    return NextResponse.json(
      { error: "Failed to scan for items needing response" },
      { status: 500 },
    );
  }
}
