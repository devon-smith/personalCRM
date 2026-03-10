import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") ?? "";
  const tier = searchParams.get("tier");
  const tag = searchParams.get("tag");
  const sort = searchParams.get("sort") ?? "name";

  const where: Prisma.ContactWhereInput = {
    userId: session.user.id,
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { company: { contains: search, mode: "insensitive" } },
      ],
    }),
    ...(tier && { tier: tier as Prisma.EnumContactTierFilter["equals"] }),
    ...(tag && { tags: { has: tag } }),
  };

  const orderBy: Prisma.ContactOrderByWithRelationInput =
    sort === "lastInteraction"
      ? { lastInteraction: { sort: "desc", nulls: "last" } }
      : sort === "createdAt"
        ? { createdAt: "desc" }
        : { name: "asc" };

  const contacts = await prisma.contact.findMany({
    where,
    orderBy,
    include: {
      _count: { select: { interactions: true } },
    },
  });

  return NextResponse.json(contacts);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const {
    name, email, phone, company, role, tier, tags,
    linkedinUrl, city, state, country, notes, followUpDays,
  } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const contact = await prisma.contact.create({
    data: {
      userId: session.user.id,
      name: name.trim(),
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      company: company?.trim() || null,
      role: role?.trim() || null,
      tier: tier ?? "PROFESSIONAL",
      tags: Array.isArray(tags) ? tags : [],
      linkedinUrl: linkedinUrl?.trim() || null,
      city: city?.trim() || null,
      state: state?.trim() || null,
      country: country?.trim() || null,
      notes: notes?.trim() || null,
      followUpDays: followUpDays ? Number(followUpDays) : null,
    },
  });

  return NextResponse.json(contact, { status: 201 });
}
