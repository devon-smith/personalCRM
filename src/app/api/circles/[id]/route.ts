import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const circle = await prisma.circle.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!circle) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json()) as {
    name?: string;
    color?: string;
    icon?: string;
    followUpDays?: number;
    sortOrder?: number;
  };

  const updated = await prisma.circle.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.color !== undefined && { color: body.color }),
      ...(body.icon !== undefined && { icon: body.icon }),
      ...(body.followUpDays !== undefined && { followUpDays: body.followUpDays }),
      ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const circle = await prisma.circle.findFirst({
    where: { id, userId: session.user.id },
    include: { _count: { select: { contacts: true } } },
  });

  if (!circle) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Delete circle and unlink contacts (ContactCircle cascades)
  await prisma.circle.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
