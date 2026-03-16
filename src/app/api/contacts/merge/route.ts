import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** POST — Merge multiple contacts into one primary contact.
 *  Body: { primaryId: string, mergeIds: string[] }
 *  - Moves all interactions from mergeIds contacts to primaryId
 *  - Fills null fields on primary from merged contacts
 *  - Moves circle memberships
 *  - Moves action items
 *  - Deletes the merged contacts
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { primaryId, mergeIds } = (await req.json()) as {
      primaryId: string;
      mergeIds: string[];
    };

    if (!primaryId || !Array.isArray(mergeIds) || mergeIds.length === 0) {
      return NextResponse.json(
        { error: "primaryId and mergeIds[] are required" },
        { status: 400 },
      );
    }

    if (mergeIds.includes(primaryId)) {
      return NextResponse.json(
        { error: "primaryId cannot be in mergeIds" },
        { status: 400 },
      );
    }

    // Verify all contacts belong to user
    const allIds = [primaryId, ...mergeIds];
    const contacts = await prisma.contact.findMany({
      where: { id: { in: allIds }, userId: session.user.id },
    });

    if (contacts.length !== allIds.length) {
      return NextResponse.json(
        { error: "One or more contacts not found" },
        { status: 404 },
      );
    }

    const primary = contacts.find((c) => c.id === primaryId)!;
    const merged = contacts.filter((c) => c.id !== primaryId);

    // Build enrichment data from merged contacts (fill nulls on primary)
    const enrichment: Record<string, string | null> = {};
    const fieldsToEnrich = [
      "email", "phone", "company", "role", "city", "state",
      "country", "linkedinUrl", "avatarUrl", "notes",
    ] as const;

    for (const field of fieldsToEnrich) {
      if (!primary[field as keyof typeof primary]) {
        for (const m of merged) {
          const val = m[field as keyof typeof m];
          if (val) {
            enrichment[field] = val as string;
            break;
          }
        }
      }
    }

    // Fill birthday if primary doesn't have one
    let mergedBirthday: Date | null = null;
    if (!primary.birthday) {
      for (const m of merged) {
        if (m.birthday) {
          mergedBirthday = m.birthday;
          break;
        }
      }
    }

    // Merge array fields: additionalEmails, additionalPhones, aliases, nicknames
    const mergeArrayField = (field: "additionalEmails" | "additionalPhones" | "aliases" | "nicknames") => {
      const allValues = new Set([
        ...(primary[field] ?? []),
        ...merged.flatMap((m) => m[field] ?? []),
      ]);
      return [...allValues];
    };

    const mergedAdditionalEmails = mergeArrayField("additionalEmails");
    const mergedAdditionalPhones = mergeArrayField("additionalPhones");
    const mergedAliases = mergeArrayField("aliases");
    const mergedNicknames = mergeArrayField("nicknames");

    // If primary has no email but merged contact does, and primary's email
    // was the one we just set via enrichment, collect the other emails as additional
    const allEmails = new Set<string>();
    for (const c of [primary, ...merged]) {
      if (c.email) allEmails.add(c.email.toLowerCase());
      for (const e of c.additionalEmails ?? []) allEmails.add(e.toLowerCase());
    }
    // The primary email (after enrichment) should not be in additionalEmails
    const primaryEmail = (enrichment.email ?? primary.email)?.toLowerCase();
    if (primaryEmail) allEmails.delete(primaryEmail);
    const finalAdditionalEmails = [...new Set([...mergedAdditionalEmails.map(e => e.toLowerCase()), ...allEmails])];

    // Use the highest tier
    const tierOrder = { INNER_CIRCLE: 0, PROFESSIONAL: 1, ACQUAINTANCE: 2 } as const;
    const bestTier = [...merged, primary].reduce((best, c) => {
      const currentRank = tierOrder[c.tier as keyof typeof tierOrder] ?? 2;
      const bestRank = tierOrder[best as keyof typeof tierOrder] ?? 2;
      return currentRank < bestRank ? c.tier : best;
    }, primary.tier);

    // Merge tags
    const allTags = new Set([...primary.tags, ...merged.flatMap((m) => m.tags)]);

    // Find the most recent lastInteraction
    const allLastInteractions = [primary, ...merged]
      .map((c) => c.lastInteraction)
      .filter(Boolean) as Date[];
    const latestInteraction = allLastInteractions.length > 0
      ? new Date(Math.max(...allLastInteractions.map((d) => d.getTime())))
      : null;

    // Use the smallest followUpDays (if set)
    const allFollowUpDays = [primary, ...merged]
      .map((c) => c.followUpDays)
      .filter((d): d is number => d !== null);
    const bestFollowUpDays = allFollowUpDays.length > 0
      ? Math.min(...allFollowUpDays)
      : null;

    // Execute merge in a transaction
    await prisma.$transaction(async (tx) => {
      // Move interactions to primary
      await tx.interaction.updateMany({
        where: { contactId: { in: mergeIds } },
        data: { contactId: primaryId },
      });

      // Move circle memberships (skip if already in circle)
      const existingCircles = await tx.contactCircle.findMany({
        where: { contactId: primaryId },
        select: { circleId: true },
      });
      const existingCircleIds = new Set(existingCircles.map((c) => c.circleId));

      const mergedCircles = await tx.contactCircle.findMany({
        where: { contactId: { in: mergeIds } },
      });

      for (const mc of mergedCircles) {
        if (!existingCircleIds.has(mc.circleId)) {
          await tx.contactCircle.create({
            data: { contactId: primaryId, circleId: mc.circleId },
          });
          existingCircleIds.add(mc.circleId);
        }
      }

      // Move action items
      await tx.actionItem.updateMany({
        where: { contactId: { in: mergeIds } },
        data: { contactId: primaryId },
      });

      // Move sightings
      await tx.contactSighting.updateMany({
        where: { contactId: { in: mergeIds } },
        data: { contactId: primaryId },
      });

      // Update primary with enriched data
      await tx.contact.update({
        where: { id: primaryId },
        data: {
          ...enrichment,
          tier: bestTier,
          tags: [...allTags],
          additionalEmails: finalAdditionalEmails,
          additionalPhones: mergedAdditionalPhones,
          aliases: mergedAliases,
          nicknames: mergedNicknames,
          ...(mergedBirthday && { birthday: mergedBirthday }),
          ...(latestInteraction && { lastInteraction: latestInteraction }),
          ...(bestFollowUpDays !== null && { followUpDays: bestFollowUpDays }),
        },
      });

      // Delete merged contacts (cascade deletes their circle memberships, sightings)
      await tx.contactCircle.deleteMany({
        where: { contactId: { in: mergeIds } },
      });
      await tx.contactSighting.deleteMany({
        where: { contactId: { in: mergeIds } },
      });
      await tx.contact.deleteMany({
        where: { id: { in: mergeIds } },
      });
    });

    // Fetch updated primary
    const updated = await prisma.contact.findUnique({
      where: { id: primaryId },
      include: { _count: { select: { interactions: true } } },
    });

    return NextResponse.json({
      merged: mergeIds.length,
      contact: updated,
    });
  } catch (error) {
    console.error("[POST /api/contacts/merge]", error);
    return NextResponse.json(
      { error: "Failed to merge contacts" },
      { status: 500 },
    );
  }
}
