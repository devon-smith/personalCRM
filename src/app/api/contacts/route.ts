import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildContactListQuery,
  ContactListQueryError,
  contactListSelect,
} from "@/lib/contact-list-query";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { where, orderBy, take } = buildContactListQuery(
      req.nextUrl.searchParams,
      session.user.id,
    );

    const contacts = await prisma.contact.findMany({
      where,
      orderBy,
      take,
      select: contactListSelect,
    });

    return NextResponse.json(contacts);
  } catch (error) {
    if (error instanceof ContactListQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

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
    name, email, additionalEmails, phone, company, role, tier, tags,
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
      additionalEmails: Array.isArray(additionalEmails)
        ? additionalEmails.map((e: string) => e.trim()).filter(Boolean)
        : [],
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
