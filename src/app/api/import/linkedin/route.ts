import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildContactIndex,
  resolveLinkedInSighting,
  type CandidateContact,
  type SightingData,
  type LinkedInResolutionResult,
} from "@/lib/identity-resolution";
import type { ContactSource, SightingResolution } from "@/generated/prisma/client";

interface LinkedInRow {
  firstName: string;
  lastName: string;
  email: string | null;
  company: string | null;
  position: string | null;
  connectedOn: string | null;
  url: string | null;
}

export interface LinkedInImportResult {
  total: number;
  autoMerged: number;
  newContacts: number;
  reviewNeeded: number;
  skipped: number;
  linkedInUrlsAdded: number;
  companyUpdates: number;
  matchBreakdown: {
    byEmail: number;
    byNameCompany: number;
    byLinkedInUrl: number;
  };
  jobChanges: { name: string; oldCompany: string; newCompany: string }[];
}

/** POST — Import LinkedIn CSV connections */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { rows } = (await req.json()) as { rows: LinkedInRow[] };

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: "No connections to import" },
        { status: 400 },
      );
    }

    if (rows.length > 5000) {
      return NextResponse.json(
        { error: "Maximum 5000 connections per import" },
        { status: 400 },
      );
    }

    const userId = session.user.id;

    // Load all existing contacts and build index
    const existingContacts = await prisma.contact.findMany({
      where: { userId },
      select: {
        id: true, name: true, email: true, phone: true,
        company: true, role: true, city: true, state: true,
        country: true, linkedinUrl: true, avatarUrl: true,
      },
    });

    let contacts: CandidateContact[] = [...existingContacts];
    let index = buildContactIndex(contacts);
    const matchedIds = new Set<string>();
    const createdNames = new Set<string>();

    const result: LinkedInImportResult = {
      total: rows.length,
      autoMerged: 0,
      newContacts: 0,
      reviewNeeded: 0,
      skipped: 0,
      linkedInUrlsAdded: 0,
      companyUpdates: 0,
      matchBreakdown: {
        byEmail: 0,
        byNameCompany: 0,
        byLinkedInUrl: 0,
      },
      jobChanges: [],
    };

    for (const row of rows) {
      const fullName = `${row.firstName} ${row.lastName}`.trim();
      if (!fullName || fullName.length < 2) {
        result.skipped++;
        continue;
      }

      const sightingData: SightingData = {
        name: fullName,
        email: row.email?.trim() || null,
        phone: null,
        company: row.company?.trim() || null,
        role: row.position?.trim() || null,
        city: null,
        state: null,
        country: null,
        linkedinUrl: row.url?.trim() || null,
        avatarUrl: null,
      };

      const externalId = row.url?.trim() || `li:${fullName}`;

      // Check idempotency
      const existingSighting = await prisma.contactSighting.findUnique({
        where: {
          userId_source_externalId: {
            userId,
            source: "LINKEDIN",
            externalId,
          },
        },
      });
      if (existingSighting) {
        result.skipped++;
        continue;
      }

      // Run LinkedIn-specific resolution
      const resolution: LinkedInResolutionResult = resolveLinkedInSighting(
        sightingData, index, matchedIds,
      );

      let contactId = resolution.contactId;
      let sightingResolution: SightingResolution = resolution.outcome;

      if (sightingResolution === "AUTO_MERGED" && contactId) {
        matchedIds.add(contactId);

        // Track match reason breakdown
        if (resolution.matchReason === "email") {
          result.matchBreakdown.byEmail++;
        } else if (resolution.matchReason === "linkedin_url") {
          result.matchBreakdown.byLinkedInUrl++;
        } else if (resolution.matchReason === "name_and_company") {
          result.matchBreakdown.byNameCompany++;
        }

        // Apply enrichment (fills null fields)
        const enrichment = resolution.enrichment;
        if (Object.keys(enrichment).length > 0) {
          await prisma.contact.update({
            where: { id: contactId },
            data: enrichment,
          });

          if (enrichment.linkedinUrl) result.linkedInUrlsAdded++;
          if (enrichment.company || enrichment.role) result.companyUpdates++;

          // Update in-memory contact
          const contact = contacts.find((c) => c.id === contactId);
          if (contact) Object.assign(contact, enrichment);
        }

        // Track job changes for review
        if (resolution.companyChanged && sightingData.company && resolution.existingCompany) {
          result.jobChanges.push({
            name: fullName,
            oldCompany: resolution.existingCompany,
            newCompany: sightingData.company,
          });
        }

        result.autoMerged++;
      } else if (sightingResolution === "REVIEW_NEEDED") {
        result.reviewNeeded++;
      } else if (sightingResolution === "NEW_CONTACT" && fullName) {
        // In-batch dedup
        const normName = fullName.toLowerCase().replace(/\s+/g, " ").trim();
        if (createdNames.has(normName)) {
          sightingResolution = "AUTO_MERGED";
          result.skipped++;
        } else {
          createdNames.add(normName);

          const newContact = await prisma.contact.create({
            data: {
              userId,
              name: fullName,
              email: sightingData.email,
              company: sightingData.company,
              role: sightingData.role,
              linkedinUrl: sightingData.linkedinUrl,
              tier: "ACQUAINTANCE",
              source: "LINKEDIN" as ContactSource,
              importedAt: new Date(),
              tags: [],
            },
          });

          contactId = newContact.id;

          // Add to in-memory index
          const candidate: CandidateContact = {
            id: newContact.id,
            name: fullName,
            email: sightingData.email,
            phone: null,
            company: sightingData.company,
            role: sightingData.role,
            city: null, state: null, country: null,
            linkedinUrl: sightingData.linkedinUrl,
            avatarUrl: null,
          };
          contacts = [...contacts, candidate];
          index = buildContactIndex(contacts);

          result.newContacts++;
        }
      }

      // Create sighting record
      await prisma.contactSighting.create({
        data: {
          userId,
          source: "LINKEDIN" as ContactSource,
          externalId,
          name: fullName,
          email: sightingData.email,
          company: sightingData.company,
          role: sightingData.role,
          linkedinUrl: sightingData.linkedinUrl,
          rawData: JSON.parse(JSON.stringify(row)),
          contactId,
          resolution: sightingResolution,
          confidence: resolution.confidence,
          resolvedAt: sightingResolution !== "REVIEW_NEEDED" ? new Date() : undefined,
        },
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/import/linkedin]", error);
    return NextResponse.json(
      { error: "Failed to import LinkedIn connections" },
      { status: 500 },
    );
  }
}
