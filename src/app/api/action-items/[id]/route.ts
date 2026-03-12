import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** PATCH — Update action item status (done, dismissed, reopen) */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json()) as { status: "OPEN" | "DONE" | "DISMISSED" };

  if (!["OPEN", "DONE", "DISMISSED"].includes(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const item = await prisma.actionItem.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.actionItem.update({
    where: { id },
    data: {
      status: body.status,
      resolvedAt: body.status === "OPEN" ? null : new Date(),
    },
  });

  return NextResponse.json({ id: updated.id, status: updated.status });
}
