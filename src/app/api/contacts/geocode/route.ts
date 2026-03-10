import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { geocodeLocation, sleep } from "@/lib/geocoding";

// POST: Geocode a single contact
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { contactId } = await req.json();
  if (!contactId) {
    return NextResponse.json(
      { error: "contactId is required" },
      { status: 400 }
    );
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId: session.user.id },
    select: { id: true, city: true, state: true, country: true },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const result = await geocodeLocation(
    contact.city,
    contact.state,
    contact.country
  );

  if (!result) {
    return NextResponse.json(
      { error: "Could not geocode location" },
      { status: 422 }
    );
  }

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      latitude: result.latitude,
      longitude: result.longitude,
    },
  });

  return NextResponse.json(result);
}

// PATCH: Batch geocode contacts missing coordinates
export async function PATCH() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contacts = await prisma.contact.findMany({
    where: {
      userId: session.user.id,
      latitude: null,
      OR: [
        { city: { not: null } },
        { state: { not: null } },
        { country: { not: null } },
      ],
    },
    select: { id: true, city: true, state: true, country: true },
    take: 10, // batch of 10 to respect rate limits
  });

  let geocoded = 0;
  let failed = 0;

  for (const contact of contacts) {
    const result = await geocodeLocation(
      contact.city,
      contact.state,
      contact.country
    );

    if (result) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          latitude: result.latitude,
          longitude: result.longitude,
        },
      });
      geocoded++;
    } else {
      failed++;
    }

    // Rate limit: 1 request per second
    await sleep(1100);
  }

  return NextResponse.json({
    geocoded,
    failed,
    remaining: Math.max(0, contacts.length - geocoded - failed),
  });
}
