import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildDuplicateGroups } from "@/lib/contact-duplicates";

/** GET — Find duplicate contact groups */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contacts = await prisma.contact.findMany({
      where: { userId: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        company: true,
        role: true,
        source: true,
        tier: true,
        lastInteraction: true,
        createdAt: true,
        _count: { select: { interactions: true } },
      },
      orderBy: { name: "asc" },
    });

    const groups = buildDuplicateGroups(contacts);

    return NextResponse.json({
      groups,
      totalGroups: groups.length,
      totalDuplicates: groups.reduce((sum, g) => sum + g.contacts.length - 1, 0),
    });
  } catch (error) {
    console.error("[GET /api/contacts/duplicates]", error);
    return NextResponse.json(
      { error: "Failed to find duplicates" },
      { status: 500 },
    );
  }
}
