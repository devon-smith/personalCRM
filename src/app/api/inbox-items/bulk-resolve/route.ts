import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await prisma.inboxItem.updateMany({
      where: {
        userId: session.user.id,
        status: "OPEN",
      },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedBy: "manual",
      },
    });

    console.log(`[inbox] Bulk-resolved ${result.count} item(s) for user ${session.user.id}`);

    return NextResponse.json({ ok: true, resolved: result.count });
  } catch (error) {
    console.error("[POST /api/inbox-items/bulk-resolve]", error);
    return NextResponse.json(
      { error: "Failed to bulk-resolve" },
      { status: 500 },
    );
  }
}
