import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ParsedContact } from "@/lib/csv-parser";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { contacts } = (await req.json()) as { contacts: ParsedContact[] };

  if (!Array.isArray(contacts) || contacts.length === 0) {
    return NextResponse.json(
      { error: "No contacts to import" },
      { status: 400 }
    );
  }

  if (contacts.length > 500) {
    return NextResponse.json(
      { error: "Maximum 500 contacts per import" },
      { status: 400 }
    );
  }

  const userId = session.user.id;

  // Get existing emails for deduplication
  const existingContacts = await prisma.contact.findMany({
    where: { userId },
    select: { email: true },
  });
  const existingEmails = new Set(
    existingContacts
      .map((c) => c.email?.toLowerCase())
      .filter(Boolean)
  );

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const contact of contacts) {
    // Validate name
    if (!contact.name || contact.name.trim().length === 0) {
      errors.push(`Skipped: missing name`);
      skipped++;
      continue;
    }

    // Deduplicate by email
    if (contact.email && existingEmails.has(contact.email.toLowerCase())) {
      skipped++;
      continue;
    }

    try {
      await prisma.contact.create({
        data: {
          userId,
          name: contact.name.trim(),
          email: contact.email?.trim() || null,
          phone: contact.phone?.trim() || null,
          company: contact.company?.trim() || null,
          role: contact.role?.trim() || null,
          tier: "PROFESSIONAL",
          tags: Array.isArray(contact.tags) ? contact.tags : [],
          linkedinUrl: contact.linkedinUrl?.trim() || null,
          city: contact.city?.trim() || null,
          state: contact.state?.trim() || null,
          country: contact.country?.trim() || null,
          notes: contact.notes?.trim() || null,
        },
      });
      created++;

      // Track the email to avoid duplicates within the same batch
      if (contact.email) {
        existingEmails.add(contact.email.toLowerCase());
      }
    } catch (err) {
      errors.push(
        `Failed to create ${contact.name}: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }

  return NextResponse.json({
    created,
    skipped,
    errors,
    total: contacts.length,
  });
}
