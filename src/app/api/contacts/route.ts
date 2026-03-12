import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

const VALID_SOURCES = new Set([
  "MANUAL", "CSV_IMPORT", "GOOGLE_CONTACTS", "GMAIL_DISCOVER",
  "APPLE_CONTACTS", "IMESSAGE", "LINKEDIN", "WHATSAPP",
]);

const VALID_TIERS = new Set(["INNER_CIRCLE", "PROFESSIONAL", "ACQUAINTANCE"]);

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const search = searchParams.get("search") ?? "";
    const tier = searchParams.get("tier");
    const source = searchParams.get("source");
    const tag = searchParams.get("tag");
    const sort = searchParams.get("sort") ?? "name";

    if (tier && !VALID_TIERS.has(tier)) {
      return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
    }
    if (source && !VALID_SOURCES.has(source)) {
      return NextResponse.json({ error: "Invalid source" }, { status: 400 });
    }

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
      ...(source && { source: source as Prisma.EnumContactSourceFilter["equals"] }),
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
  } catch (error) {
    console.error("[GET /api/contacts]", error);
    return NextResponse.json(
      { error: "Failed to fetch contacts" },
      { status: 500 },
    );
  }
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
