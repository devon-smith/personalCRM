import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ChangelogStatus } from "@/generated/prisma/client";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const status = body.status as ChangelogStatus;

  if (!["SEEN", "ACTED", "DISMISSED"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const entry = await prisma.contactChangelog.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!entry) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.contactChangelog.update({
    where: { id },
    data: {
      status,
      actedAt: status === "ACTED" ? new Date() : undefined,
    },
  });

  return NextResponse.json(updated);
}
