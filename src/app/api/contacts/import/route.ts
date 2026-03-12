import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { ParsedContact } from "@/lib/csv-parser";
import { processBatch, type SightingInput } from "@/lib/sightings";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { contacts, source: requestedSource } = (await req.json()) as {
    contacts: ParsedContact[];
    source?: string;
  };

  const VALID_IMPORT_SOURCES = new Set([
    "CSV_IMPORT", "LINKEDIN", "GOOGLE_CONTACTS", "APPLE_CONTACTS",
  ]);
  const importSource = (requestedSource && VALID_IMPORT_SOURCES.has(requestedSource))
    ? requestedSource
    : "CSV_IMPORT";

  if (!Array.isArray(contacts) || contacts.length === 0) {
    return NextResponse.json(
      { error: "No contacts to import" },
      { status: 400 },
    );
  }

  if (contacts.length > 500) {
    return NextResponse.json(
      { error: "Maximum 500 contacts per import" },
      { status: 400 },
    );
  }

  // Convert parsed contacts to sighting inputs
  const sightings: SightingInput[] = contacts
    .filter((c) => c.name && c.name.trim().length > 0)
    .map((c) => ({
      source: importSource as "CSV_IMPORT",
      externalId: c.linkedinUrl?.trim() || c.email || `csv:${c.name}`,
      name: c.name.trim(),
      email: c.email?.trim() || null,
      phone: c.phone?.trim() || null,
      company: c.company?.trim() || null,
      role: c.role?.trim() || null,
      city: c.city?.trim() || null,
      state: c.state?.trim() || null,
      country: c.country?.trim() || null,
      linkedinUrl: c.linkedinUrl?.trim() || null,
      tags: Array.isArray(c.tags) ? c.tags : [],
      notes: c.notes?.trim() || null,
    }));

  const batch = await processBatch(session.user.id, sightings);

  return NextResponse.json({
    created: batch.created,
    skipped: batch.skipped + batch.merged,
    reviewNeeded: batch.reviewNeeded,
    errors: [],
    total: contacts.length,
  });
}
