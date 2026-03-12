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
      additionalEmails?: string[];
      phone: string | null;
      company: string | null;
      role: string | null;
      birthday: string | null;
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

  // Save additional emails from Google Contacts
  const contactsWithExtras = body.contacts.filter((c) => c.additionalEmails?.length);
  if (contactsWithExtras.length > 0) {
    const allContactsForEmails = await prisma.contact.findMany({
      where: { userId: session.user.id },
      select: { id: true, name: true, email: true, additionalEmails: true },
    });

    const contactByEmail = new Map(
      allContactsForEmails.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]),
    );
    const contactByName = new Map(
      allContactsForEmails.map((c) => [c.name.toLowerCase().trim(), c]),
    );

    for (const gc of contactsWithExtras) {
      const match =
        (gc.email ? contactByEmail.get(gc.email.toLowerCase()) : undefined) ??
        contactByName.get(gc.name.toLowerCase().trim());
      if (match) {
        const existingSet = new Set([
          ...(match.email ? [match.email.toLowerCase()] : []),
          ...match.additionalEmails.map((e) => e.toLowerCase()),
        ]);
        const newEmails = (gc.additionalEmails ?? []).filter(
          (e) => !existingSet.has(e.toLowerCase()),
        );
        if (newEmails.length > 0) {
          await prisma.contact.update({
            where: { id: match.id },
            data: { additionalEmails: [...match.additionalEmails, ...newEmails] },
          });
        }
      }
    }
  }

  // Save birthdays from Google Contacts for contacts that don't already have one
  const contactsWithBirthdays = body.contacts.filter((c) => c.birthday);
  if (contactsWithBirthdays.length > 0) {
    const allContacts = await prisma.contact.findMany({
      where: { userId: session.user.id, birthday: null },
      select: { id: true, name: true, email: true },
    });

    const contactByEmail = new Map(
      allContacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]),
    );
    const contactByName = new Map(
      allContacts.map((c) => [c.name.toLowerCase().trim(), c]),
    );

    for (const gc of contactsWithBirthdays) {
      const match =
        (gc.email ? contactByEmail.get(gc.email.toLowerCase()) : undefined) ??
        contactByName.get(gc.name.toLowerCase().trim());
      if (match) {
        await prisma.contact.update({
          where: { id: match.id },
          data: { birthday: new Date(gc.birthday!) },
        });
      }
    }
  }

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
