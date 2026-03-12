import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json()) as { contactIds: string[] };

  if (!Array.isArray(body.contactIds) || body.contactIds.length === 0) {
    return NextResponse.json({ error: "contactIds required" }, { status: 400 });
  }

  const circle = await prisma.circle.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!circle) {
    return NextResponse.json({ error: "Circle not found" }, { status: 404 });
  }

  // Verify contacts belong to user
  const contacts = await prisma.contact.findMany({
    where: { id: { in: body.contactIds }, userId: session.user.id },
    select: { id: true },
  });
  const validIds = contacts.map((c) => c.id);

  // Upsert (skip existing links)
  const created = await prisma.contactCircle.createMany({
    data: validIds.map((contactId) => ({
      contactId,
      circleId: id,
    })),
    skipDuplicates: true,
  });

  return NextResponse.json({ added: created.count });
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json()) as { contactIds: string[] };

  if (!Array.isArray(body.contactIds) || body.contactIds.length === 0) {
    return NextResponse.json({ error: "contactIds required" }, { status: 400 });
  }

  const circle = await prisma.circle.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!circle) {
    return NextResponse.json({ error: "Circle not found" }, { status: 404 });
  }

  await prisma.contactCircle.deleteMany({
    where: {
      circleId: id,
      contactId: { in: body.contactIds },
    },
  });

  return NextResponse.json({ success: true });
}
