import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findNicknameMatches } from "@/lib/nicknames";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contacts = await prisma.contact.findMany({
      where: { userId: session.user.id },
      select: {
        id: true,
        name: true,
        company: true,
        email: true,
        nicknames: true,
        avatarUrl: true,
        tier: true,
      },
    });

    const suggestions = findNicknameMatches(contacts);

    // Enrich suggestions with avatar/tier info
    const contactLookup = new Map(contacts.map((c) => [c.id, c]));

    const enriched = suggestions.map((s) => ({
      ...s,
      contactA: {
        ...s.contactA,
        avatarUrl: contactLookup.get(s.contactA.id)?.avatarUrl ?? null,
        tier: contactLookup.get(s.contactA.id)?.tier ?? null,
      },
      contactB: {
        ...s.contactB,
        avatarUrl: contactLookup.get(s.contactB.id)?.avatarUrl ?? null,
        tier: contactLookup.get(s.contactB.id)?.tier ?? null,
      },
    }));

    return NextResponse.json({ suggestions: enriched });
  } catch (error) {
    console.error("[GET /api/contacts/nickname-matches]", error);
    return NextResponse.json(
      { error: "Failed to find nickname matches" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action, contactAId, contactBId } = body as {
      action: "merge" | "dismiss";
      contactAId: string;
      contactBId: string;
    };

    if (!action || !contactAId || !contactBId) {
      return NextResponse.json(
        { error: "Missing required fields: action, contactAId, contactBId" },
        { status: 400 },
      );
    }

    // Verify both contacts belong to this user
    const [contactA, contactB] = await Promise.all([
      prisma.contact.findFirst({
        where: { id: contactAId, userId: session.user.id },
      }),
      prisma.contact.findFirst({
        where: { id: contactBId, userId: session.user.id },
      }),
    ]);

    if (!contactA || !contactB) {
      return NextResponse.json(
        { error: "One or both contacts not found" },
        { status: 404 },
      );
    }

    if (action === "dismiss") {
      // Add each contact's first name as a "not-a-match" nickname on the other
      // so they don't get suggested again. We store the full name to track dismissals.
      const aFirst = contactA.name.split(/\s+/)[0];
      const bFirst = contactB.name.split(/\s+/)[0];

      await Promise.all([
        prisma.contact.update({
          where: { id: contactAId },
          data: {
            nicknames: {
              push: `!not:${bFirst.toLowerCase()}:${contactBId}`,
            },
          },
        }),
        prisma.contact.update({
          where: { id: contactBId },
          data: {
            nicknames: {
              push: `!not:${aFirst.toLowerCase()}:${contactAId}`,
            },
          },
        }),
      ]);

      return NextResponse.json({ status: "dismissed" });
    }

    if (action === "merge") {
      // Merge contactB into contactA (keep A, transfer B's data)
      const mergedEmails = new Set([
        ...(contactA.email ? [contactA.email] : []),
        ...contactA.additionalEmails,
        ...(contactB.email ? [contactB.email] : []),
        ...contactB.additionalEmails,
      ]);

      // Remove A's primary email from the set to avoid duplication
      const primaryEmail = contactA.email;
      if (primaryEmail) mergedEmails.delete(primaryEmail);

      const mergedPhones = new Set([
        ...(contactA.phone ? [contactA.phone] : []),
        ...contactA.additionalPhones,
        ...(contactB.phone ? [contactB.phone] : []),
        ...contactB.additionalPhones,
      ]);
      const primaryPhone = contactA.phone;
      if (primaryPhone) mergedPhones.delete(primaryPhone);

      const mergedNicknames = new Set([
        ...contactA.nicknames.filter((n: string) => !n.startsWith("!not:")),
        ...contactB.nicknames.filter((n: string) => !n.startsWith("!not:")),
        contactB.name.split(/\s+/)[0].toLowerCase(),
      ]);

      const mergedAliases = new Set([
        ...contactA.aliases,
        ...contactB.aliases,
      ]);

      const mergedTags = new Set([
        ...contactA.tags,
        ...contactB.tags,
      ]);

      await prisma.$transaction([
        // Transfer all interactions from B to A
        prisma.interaction.updateMany({
          where: { contactId: contactBId },
          data: { contactId: contactAId },
        }),
        // Transfer email messages
        prisma.emailMessage.updateMany({
          where: { contactId: contactBId },
          data: { contactId: contactAId },
        }),
        // Transfer action items
        prisma.actionItem.updateMany({
          where: { contactId: contactBId },
          data: { contactId: contactAId },
        }),
        // Transfer circle memberships (ignore conflicts)
        prisma.contactCircle.updateMany({
          where: { contactId: contactBId },
          data: { contactId: contactAId },
        }),
        // Transfer sightings
        prisma.contactSighting.updateMany({
          where: { contactId: contactBId },
          data: { contactId: contactAId },
        }),
        // Transfer drafts
        prisma.draft.updateMany({
          where: { contactId: contactBId },
          data: { contactId: contactAId },
        }),
        // Update contact A with merged data
        prisma.contact.update({
          where: { id: contactAId },
          data: {
            additionalEmails: [...mergedEmails],
            additionalPhones: [...mergedPhones],
            nicknames: [...mergedNicknames],
            aliases: [...mergedAliases],
            tags: [...mergedTags],
            phone: contactA.phone ?? contactB.phone,
            company: contactA.company ?? contactB.company,
            role: contactA.role ?? contactB.role,
            linkedinUrl: contactA.linkedinUrl ?? contactB.linkedinUrl,
            city: contactA.city ?? contactB.city,
            state: contactA.state ?? contactB.state,
            country: contactA.country ?? contactB.country,
            avatarUrl: contactA.avatarUrl ?? contactB.avatarUrl,
            birthday: contactA.birthday ?? contactB.birthday,
            howWeMet: contactA.howWeMet ?? contactB.howWeMet,
          },
        }),
        // Delete contact B
        prisma.contact.delete({ where: { id: contactBId } }),
      ]);

      return NextResponse.json({
        status: "merged",
        survivingContactId: contactAId,
      });
    }

    return NextResponse.json(
      { error: "Invalid action. Use 'merge' or 'dismiss'" },
      { status: 400 },
    );
  } catch (error) {
    console.error("[POST /api/contacts/nickname-matches]", error);
    return NextResponse.json(
      { error: "Failed to process nickname match" },
      { status: 500 },
    );
  }
}
