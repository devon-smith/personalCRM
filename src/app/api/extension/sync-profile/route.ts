import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createBatchContext, processOneSighting } from "@/lib/sightings";
import { detectChanges } from "@/lib/changelog";

interface SyncProfileBody {
  linkedinUrl: string;
  name: string;
  headline: string | null;
  company: string | null;
  role: string | null;
  location: string | null;
  avatarUrl: string | null;
  connectionDegree: string | null;
  emails: string[];
  phones: string[];
  websites: string[];
  birthday: string | null;
  aboutText: string | null;
  mutualConnections: number | null;
}

/**
 * POST /api/extension/sync-profile
 * Receives LinkedIn profile data, runs sightings pipeline, detects changes.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const body = (await request.json()) as SyncProfileBody;

    if (!body.name || !body.linkedinUrl) {
      return NextResponse.json(
        { error: "name and linkedinUrl are required" },
        { status: 400 },
      );
    }

    // Normalize LinkedIn URL
    const linkedinUrl = normalizeLinkedInUrl(body.linkedinUrl);

    // Parse location into city/state/country
    const location = parseLocation(body.location);

    // Check if contact already exists by LinkedIn URL
    const existingByUrl = await prisma.contact.findFirst({
      where: { userId, linkedinUrl },
      select: {
        id: true,
        name: true,
        company: true,
        role: true,
        email: true,
        phone: true,
        avatarUrl: true,
        additionalEmails: true,
        additionalPhones: true,
      },
    });

    if (existingByUrl) {
      // Existing contact — detect changes and enrich
      const changes: Array<{ field: string; old: string | null; new: string }> = [];
      const enrichments: Array<{ field: string; value: string }> = [];
      const updateData: Record<string, unknown> = {};

      // Detect job/role changes
      if (body.company || body.role) {
        await detectChanges(
          userId,
          existingByUrl.id,
          { company: existingByUrl.company, role: existingByUrl.role },
          { company: body.company, role: body.role },
          "linkedin_extension",
        );

        if (body.company && body.company !== existingByUrl.company) {
          changes.push({ field: "company", old: existingByUrl.company, new: body.company });
        }
        if (body.role && body.role !== existingByUrl.role) {
          changes.push({ field: "role", old: existingByUrl.role, new: body.role });
        }
      }

      // Enrich null fields
      if (!existingByUrl.avatarUrl && body.avatarUrl) {
        updateData.avatarUrl = body.avatarUrl;
        enrichments.push({ field: "avatarUrl", value: body.avatarUrl });
      }
      if (!existingByUrl.email && body.emails.length > 0) {
        updateData.email = body.emails[0];
        enrichments.push({ field: "email", value: body.emails[0] });
      }
      if (!existingByUrl.phone && body.phones.length > 0) {
        updateData.phone = body.phones[0];
        enrichments.push({ field: "phone", value: body.phones[0] });
      }
      if (location.city) {
        updateData.city = location.city;
      }
      if (location.state) {
        updateData.state = location.state;
      }

      // Add additional emails that aren't already tracked
      const allExistingEmails = new Set([
        ...(existingByUrl.email ? [existingByUrl.email.toLowerCase()] : []),
        ...existingByUrl.additionalEmails.map((e) => e.toLowerCase()),
      ]);
      const newEmails = body.emails.filter(
        (e) => !allExistingEmails.has(e.toLowerCase()),
      );
      if (newEmails.length > 0) {
        updateData.additionalEmails = [
          ...existingByUrl.additionalEmails,
          ...newEmails,
        ];
        enrichments.push({ field: "additionalEmails", value: newEmails.join(", ") });
      }

      // Add additional phones
      const allExistingPhones = new Set([
        ...(existingByUrl.phone ? [existingByUrl.phone] : []),
        ...existingByUrl.additionalPhones,
      ]);
      const newPhones = body.phones.filter((p) => !allExistingPhones.has(p));
      if (newPhones.length > 0) {
        updateData.additionalPhones = [
          ...existingByUrl.additionalPhones,
          ...newPhones,
        ];
        enrichments.push({ field: "additionalPhones", value: newPhones.join(", ") });
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.contact.update({
          where: { id: existingByUrl.id },
          data: updateData,
        });
      }

      const status = enrichments.length > 0 ? "enriched" : "matched";
      return NextResponse.json({
        status,
        contactId: existingByUrl.id,
        contactName: existingByUrl.name,
        changes,
        enrichments,
        message:
          changes.length > 0
            ? `Job change detected for ${existingByUrl.name}`
            : enrichments.length > 0
              ? `Enriched ${existingByUrl.name} with ${enrichments.length} field(s)`
              : `${existingByUrl.name} is up to date`,
      });
    }

    // Not found by URL — run through sightings pipeline
    const ctx = await createBatchContext(userId);
    const resolution = await processOneSighting(ctx, {
      source: "LINKEDIN",
      externalId: linkedinUrl,
      name: body.name,
      email: body.emails[0] ?? null,
      phone: body.phones[0] ?? null,
      company: body.company,
      role: body.role,
      city: location.city,
      state: location.state,
      country: location.country,
      linkedinUrl,
      avatarUrl: body.avatarUrl,
    });

    // Find the created/matched contact
    const contact = await prisma.contact.findFirst({
      where: { userId, linkedinUrl },
      select: { id: true, name: true },
    });

    if (resolution === "NEW_CONTACT") {
      // Add additional emails/phones beyond the primary
      if (contact && (body.emails.length > 1 || body.phones.length > 1)) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: {
            additionalEmails: body.emails.slice(1),
            additionalPhones: body.phones.slice(1),
          },
        });
      }

      return NextResponse.json({
        status: "created",
        contactId: contact?.id ?? null,
        contactName: contact?.name ?? body.name,
        changes: [],
        enrichments: [],
        message: `Created new contact: ${body.name}`,
      });
    }

    if (resolution === "REVIEW_NEEDED") {
      return NextResponse.json({
        status: "review",
        contactId: contact?.id ?? null,
        contactName: contact?.name ?? body.name,
        changes: [],
        enrichments: [],
        message: `${body.name} needs manual review — possible duplicate`,
      });
    }

    // AUTO_MERGED
    return NextResponse.json({
      status: "matched",
      contactId: contact?.id ?? null,
      contactName: contact?.name ?? body.name,
      changes: [],
      enrichments: [],
      message: `Matched to existing contact: ${contact?.name ?? body.name}`,
    });
  } catch (error) {
    console.error("[POST /api/extension/sync-profile]", error);
    return NextResponse.json(
      { error: "Failed to sync profile" },
      { status: 500 },
    );
  }
}

function normalizeLinkedInUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let path = parsed.pathname.replace(/\/+$/, "");
    if (!path.startsWith("/in/")) {
      path = `/in/${path.split("/in/")[1] ?? path}`;
    }
    return `https://www.linkedin.com${path}`;
  } catch {
    return url;
  }
}

function parseLocation(location: string | null): {
  city: string | null;
  state: string | null;
  country: string | null;
} {
  if (!location) return { city: null, state: null, country: null };
  const parts = location.split(",").map((p) => p.trim());
  if (parts.length >= 3) {
    return { city: parts[0], state: parts[1], country: parts[2] };
  }
  if (parts.length === 2) {
    return { city: parts[0], state: parts[1], country: null };
  }
  return { city: parts[0], state: null, country: null };
}
