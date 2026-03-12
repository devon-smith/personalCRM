import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchGoogleContacts } from "@/lib/gmail/contacts-import";
import { processBatch, type SightingInput } from "@/lib/sightings";

/** GET — Preview Google Contacts (don't import yet) */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contacts = await fetchGoogleContacts(session.user.id, 2000);
    return NextResponse.json({ contacts, total: contacts.length });
  } catch (error) {
    console.error("Google Contacts fetch error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch Google Contacts" },
      { status: 500 },
    );
  }
}

/** POST — Import selected Google Contacts via identity resolution */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    contacts: Array<{
      name: string;
      email: string | null;
      phone: string | null;
      company: string | null;
      role: string | null;
      circleId?: string;
    }>;
  };

  if (!body.contacts || body.contacts.length === 0) {
    return NextResponse.json({ error: "No contacts provided" }, { status: 400 });
  }

  if (body.contacts.length > 2000) {
    return NextResponse.json({ error: "Maximum 2000 contacts per import" }, { status: 400 });
  }

  // Convert to sighting inputs
  const sightings: SightingInput[] = body.contacts.map((c) => ({
    source: "GOOGLE_CONTACTS" as const,
    externalId: c.email ?? `gcontact:${c.name}`,
    name: c.name,
    email: c.email,
    phone: c.phone,
    company: c.company,
    role: c.role,
    city: null,
    state: null,
    country: null,
    linkedinUrl: null,
  }));

  const batch = await processBatch(session.user.id, sightings);

  // Mark contacts as imported in gmail sync state
  await prisma.gmailSyncState.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, contactsImported: true },
    update: { contactsImported: true },
  });

  return NextResponse.json({
    imported: batch.created,
    skipped: batch.skipped + batch.merged,
    reviewNeeded: batch.reviewNeeded,
  });
}
