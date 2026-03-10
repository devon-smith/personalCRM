import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
  const { connect, disconnect } = body as {
    connect?: string[];
    disconnect?: string[];
  };

  const existing = await prisma.jobApplication.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const job = await prisma.jobApplication.update({
    where: { id },
    data: {
      contacts: {
        ...(connect && { connect: connect.map((cid) => ({ id: cid })) }),
        ...(disconnect && { disconnect: disconnect.map((cid) => ({ id: cid })) }),
      },
    },
    include: {
      contacts: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  return NextResponse.json(job);
}
