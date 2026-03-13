import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface MapContact {
  readonly id: string;
  readonly name: string;
  readonly company: string | null;
  readonly role: string | null;
  readonly avatarUrl: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly city: string | null;
  readonly state: string | null;
  readonly country: string | null;
  readonly circleId: string;
  readonly circleName: string;
  readonly circleColor: string;
}

export interface MapResponse {
  readonly contacts: readonly MapContact[];
  readonly totalContacts: number;
  readonly locatedContacts: number;
  readonly cities: number;
  readonly countries: number;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const totalContacts = await prisma.contact.count({
      where: { userId: session.user.id },
    });

    // Fetch contacts that have lat/lng and belong to at least one circle
    const memberships = await prisma.contactCircle.findMany({
      where: {
        circle: { userId: session.user.id },
        contact: {
          latitude: { not: null },
          longitude: { not: null },
        },
      },
      select: {
        circle: {
          select: { id: true, name: true, color: true },
        },
        contact: {
          select: {
            id: true,
            name: true,
            company: true,
            role: true,
            avatarUrl: true,
            latitude: true,
            longitude: true,
            city: true,
            state: true,
            country: true,
          },
        },
      },
    });

    // Also fetch located contacts that are NOT in any circle
    const uncircledContacts = await prisma.contact.findMany({
      where: {
        userId: session.user.id,
        latitude: { not: null },
        longitude: { not: null },
        circles: { none: {} },
      },
      select: {
        id: true,
        name: true,
        company: true,
        role: true,
        avatarUrl: true,
        latitude: true,
        longitude: true,
        city: true,
        state: true,
        country: true,
      },
    });

    // Build map contacts — one entry per circle membership
    const mapContacts: MapContact[] = memberships.map((m) => ({
      id: m.contact.id,
      name: m.contact.name,
      company: m.contact.company,
      role: m.contact.role,
      avatarUrl: m.contact.avatarUrl,
      latitude: m.contact.latitude!,
      longitude: m.contact.longitude!,
      city: m.contact.city,
      state: m.contact.state,
      country: m.contact.country,
      circleId: m.circle.id,
      circleName: m.circle.name,
      circleColor: m.circle.color,
    }));

    // Add uncircled contacts with a default circle
    for (const c of uncircledContacts) {
      mapContacts.push({
        id: c.id,
        name: c.name,
        company: c.company,
        role: c.role,
        avatarUrl: c.avatarUrl,
        latitude: c.latitude!,
        longitude: c.longitude!,
        city: c.city,
        state: c.state,
        country: c.country,
        circleId: "__uncircled__",
        circleName: "Uncircled",
        circleColor: "#6b7280",
      });
    }

    // Deduplicate by contact ID (keep first circle membership)
    const seen = new Set<string>();
    const uniqueContacts = mapContacts.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    const cities = new Set(uniqueContacts.map((c) => c.city).filter(Boolean));
    const countries = new Set(uniqueContacts.map((c) => c.country).filter(Boolean));

    return NextResponse.json({
      contacts: mapContacts,
      totalContacts,
      locatedContacts: uniqueContacts.length,
      cities: cities.size,
      countries: countries.size,
    } satisfies MapResponse);
  } catch (error) {
    console.error("[GET /api/circles/map]", error);
    return NextResponse.json(
      { error: "Failed to load map data" },
      { status: 500 },
    );
  }
}
