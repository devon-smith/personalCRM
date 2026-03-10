import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await prisma.jobApplication.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      contacts: {
        select: { id: true, name: true, avatarUrl: true },
      },
    },
  });

  return NextResponse.json(jobs);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { company, roleTitle, url, status, salaryRange, deadline, notes } = body;

  if (!company?.trim() || !roleTitle?.trim()) {
    return NextResponse.json(
      { error: "Company and role title are required" },
      { status: 400 }
    );
  }

  const job = await prisma.jobApplication.create({
    data: {
      userId: session.user.id,
      company: company.trim(),
      roleTitle: roleTitle.trim(),
      url: url?.trim() || null,
      status: status ?? "INTERESTED",
      salaryRange: salaryRange?.trim() || null,
      deadline: deadline ? new Date(deadline) : null,
      notes: notes?.trim() || null,
    },
    include: {
      contacts: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  return NextResponse.json(job, { status: 201 });
}
