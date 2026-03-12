import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readAppleContacts } from "@/lib/apple-contacts";
import { processBatch, type SightingInput } from "@/lib/sightings";

/** GET — Preview Apple Contacts (read from macOS, don't import yet) */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await readAppleContacts();

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      contacts: result.contacts,
      total: result.total,
    });
  } catch (error) {
    console.error("Apple Contacts read error:", error);
    return NextResponse.json(
      { error: "Failed to read Apple Contacts" },
      { status: 500 },
    );
  }
}

/** POST — Import Apple Contacts via identity resolution engine */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await readAppleContacts();

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Convert Apple contacts to sighting inputs
    const sightings: SightingInput[] = result.contacts.map((c) => ({
      source: "APPLE_CONTACTS" as const,
      externalId: c.email ?? c.phone ?? c.name, // best unique key we have
      name: c.name,
      email: c.email,
      phone: c.phone,
      company: c.company,
      role: c.role,
      city: c.city,
      state: c.state,
      country: c.country,
      linkedinUrl: c.linkedinUrl,
      avatarUrl: null,
      tags: c.tags,
      notes: c.notes,
    }));

    const batch = await processBatch(session.user.id, sightings);

    return NextResponse.json({
      created: batch.created,
      enriched: batch.merged,
      reviewNeeded: batch.reviewNeeded,
      skipped: batch.skipped,
      total: batch.total,
    });
  } catch (error) {
    console.error("Apple Contacts import error:", error);
    return NextResponse.json(
      { error: "Failed to import Apple Contacts" },
      { status: 500 },
    );
  }
}
