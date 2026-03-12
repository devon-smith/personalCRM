import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface ReviewItem {
  id: string;
  source: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  confidence: number | null;
  seenAt: string;
  candidate: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
  } | null;
}

/** GET — List sightings pending review */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sightings = await prisma.contactSighting.findMany({
      where: { userId: session.user.id, resolution: "REVIEW_NEEDED" },
      orderBy: [{ confidence: "desc" }, { seenAt: "desc" }],
      include: {
        contact: {
          select: { id: true, name: true, email: true, phone: true, company: true },
        },
      },
      take: 50,
    });

    const items: ReviewItem[] = sightings.map((s) => ({
      id: s.id,
      source: s.source,
      name: s.name,
      email: s.email,
      phone: s.phone,
      company: s.company,
      confidence: s.confidence,
      seenAt: s.seenAt.toISOString(),
      candidate: s.contact,
    }));

    const totalPending = await prisma.contactSighting.count({
      where: { userId: session.user.id, resolution: "REVIEW_NEEDED" },
    });

    return NextResponse.json({ items, totalPending });
  } catch (error) {
    console.error("[GET /api/sightings]", error);
    return NextResponse.json(
      { error: "Failed to fetch review queue" },
      { status: 500 },
    );
  }
}

/** PATCH — Resolve a sighting (merge, create, or dismiss) */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sightingId, action } = (await req.json()) as {
    sightingId: string;
    action: "merge" | "create" | "dismiss";
  };

  if (!sightingId || !["merge", "create", "dismiss"].includes(action)) {
    return NextResponse.json(
      { error: "sightingId and action (merge|create|dismiss) are required" },
      { status: 400 },
    );
  }

  const sighting = await prisma.contactSighting.findFirst({
    where: { id: sightingId, userId: session.user.id },
  });

  if (!sighting) {
    return NextResponse.json({ error: "Sighting not found" }, { status: 404 });
  }

  if (action === "merge") {
    // Merge into the candidate contact
    if (!sighting.contactId) {
      return NextResponse.json(
        { error: "No candidate contact to merge into" },
        { status: 400 },
      );
    }

    // Enrich the existing contact with sighting data (fill nulls only)
    const contact = await prisma.contact.findUnique({
      where: { id: sighting.contactId },
    });

    if (contact) {
      const updates: Record<string, string> = {};
      if (!contact.phone && sighting.phone) updates.phone = sighting.phone;
      if (!contact.company && sighting.company) updates.company = sighting.company;
      if (!contact.role && sighting.role) updates.role = sighting.role;
      if (!contact.email && sighting.email) updates.email = sighting.email;
      if (!contact.city && sighting.city) updates.city = sighting.city;
      if (!contact.state && sighting.state) updates.state = sighting.state;
      if (!contact.country && sighting.country) updates.country = sighting.country;
      if (!contact.linkedinUrl && sighting.linkedinUrl) updates.linkedinUrl = sighting.linkedinUrl;

      if (Object.keys(updates).length > 0) {
        await prisma.contact.update({
          where: { id: sighting.contactId },
          data: updates,
        });
      }
    }

    await prisma.contactSighting.update({
      where: { id: sightingId },
      data: { resolution: "MANUALLY_MERGED", resolvedAt: new Date() },
    });

    return NextResponse.json({ resolution: "MANUALLY_MERGED" });
  }

  if (action === "create") {
    // Create a new contact from the sighting data
    if (!sighting.name) {
      return NextResponse.json(
        { error: "Sighting has no name — cannot create contact" },
        { status: 400 },
      );
    }

    const newContact = await prisma.contact.create({
      data: {
        userId: session.user.id,
        name: sighting.name,
        email: sighting.email,
        phone: sighting.phone,
        company: sighting.company,
        role: sighting.role,
        city: sighting.city,
        state: sighting.state,
        country: sighting.country,
        linkedinUrl: sighting.linkedinUrl,
        avatarUrl: sighting.avatarUrl,
        source: sighting.source,
        tier: "ACQUAINTANCE",
        importedAt: new Date(),
      },
    });

    await prisma.contactSighting.update({
      where: { id: sightingId },
      data: {
        resolution: "NEW_CONTACT",
        contactId: newContact.id,
        resolvedAt: new Date(),
      },
    });

    return NextResponse.json({ resolution: "NEW_CONTACT", contactId: newContact.id });
  }

  if (action === "dismiss") {
    await prisma.contactSighting.update({
      where: { id: sightingId },
      data: { resolution: "MANUALLY_REJECTED", resolvedAt: new Date() },
    });

    return NextResponse.json({ resolution: "MANUALLY_REJECTED" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
