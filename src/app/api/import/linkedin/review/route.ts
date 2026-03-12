import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface LinkedInReviewContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  linkedinUrl: string | null;
  source: string;
  tier: string;
  interactionCount: number;
  lastInteraction: string | null;
}

export interface LinkedInReviewItem {
  id: string;
  sightingName: string;
  sightingEmail: string | null;
  sightingCompany: string | null;
  sightingRole: string | null;
  sightingLinkedinUrl: string | null;
  sightingConnectedOn: string | null;
  confidence: number;
  category: "job_change" | "name_match" | "partial_match";
  categoryLabel: string;
  candidate: LinkedInReviewContact | null;
}

export interface LinkedInReviewResponse {
  items: LinkedInReviewItem[];
  totalPending: number;
  summary: {
    jobChanges: number;
    nameMatches: number;
    partialMatches: number;
  };
}

/** GET — Fetch LinkedIn-specific review queue with rich context */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sightings = await prisma.contactSighting.findMany({
      where: {
        userId: session.user.id,
        source: "LINKEDIN",
        resolution: "REVIEW_NEEDED",
      },
      orderBy: [{ confidence: "desc" }, { seenAt: "desc" }],
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            company: true,
            role: true,
            linkedinUrl: true,
            source: true,
            tier: true,
            lastInteraction: true,
            _count: { select: { interactions: true } },
          },
        },
      },
    });

    const items: LinkedInReviewItem[] = sightings.map((s) => {
      // Determine category from confidence and data
      let category: LinkedInReviewItem["category"] = "partial_match";
      let categoryLabel = "Possible match";

      if (s.confidence === 0.75 && s.contact?.company && s.company &&
          s.contact.company.toLowerCase() !== s.company.toLowerCase()) {
        category = "job_change";
        categoryLabel = `May have moved: ${s.contact.company} → ${s.company}`;
      } else if (s.confidence === 0.75) {
        category = "name_match";
        categoryLabel = "Same name, confirm identity";
      } else if (s.confidence === 0.70) {
        category = "partial_match";
        categoryLabel = "Name + initial + company match";
      } else if (s.confidence === 0.60) {
        category = "partial_match";
        categoryLabel = "Same last name + company";
      }

      // Extract connectedOn from rawData
      const rawData = s.rawData as Record<string, unknown> | null;
      const connectedOn = rawData?.connectedOn as string | null ?? null;

      const candidate: LinkedInReviewContact | null = s.contact
        ? {
            id: s.contact.id,
            name: s.contact.name,
            email: s.contact.email,
            phone: s.contact.phone,
            company: s.contact.company,
            role: s.contact.role,
            linkedinUrl: s.contact.linkedinUrl,
            source: s.contact.source,
            tier: s.contact.tier,
            interactionCount: s.contact._count.interactions,
            lastInteraction: s.contact.lastInteraction?.toISOString() ?? null,
          }
        : null;

      return {
        id: s.id,
        sightingName: s.name ?? "",
        sightingEmail: s.email,
        sightingCompany: s.company,
        sightingRole: s.role,
        sightingLinkedinUrl: s.linkedinUrl,
        sightingConnectedOn: connectedOn,
        confidence: s.confidence ?? 0,
        category,
        categoryLabel,
        candidate,
      };
    });

    const totalPending = items.length;
    const summary = {
      jobChanges: items.filter((i) => i.category === "job_change").length,
      nameMatches: items.filter((i) => i.category === "name_match").length,
      partialMatches: items.filter((i) => i.category === "partial_match").length,
    };

    return NextResponse.json({ items, totalPending, summary });
  } catch (error) {
    console.error("[GET /api/import/linkedin/review]", error);
    return NextResponse.json(
      { error: "Failed to fetch review queue" },
      { status: 500 },
    );
  }
}

/** PATCH — Resolve a LinkedIn review item */
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      sightingId: string;
      action: "link" | "create" | "dismiss";
      updateCompany?: boolean; // for job_change items: overwrite company?
    };

    if (!body.sightingId || !["link", "create", "dismiss"].includes(body.action)) {
      return NextResponse.json(
        { error: "sightingId and action (link|create|dismiss) required" },
        { status: 400 },
      );
    }

    const sighting = await prisma.contactSighting.findFirst({
      where: { id: body.sightingId, userId: session.user.id, resolution: "REVIEW_NEEDED" },
    });

    if (!sighting) {
      return NextResponse.json({ error: "Review item not found" }, { status: 404 });
    }

    if (body.action === "link") {
      // Merge into the candidate contact + attach LinkedIn URL
      if (!sighting.contactId) {
        return NextResponse.json(
          { error: "No candidate contact to link to" },
          { status: 400 },
        );
      }

      const contact = await prisma.contact.findUnique({
        where: { id: sighting.contactId },
      });

      if (contact) {
        const updates: Record<string, string | null> = {};

        // Always attach LinkedIn URL if not set
        if (!contact.linkedinUrl && sighting.linkedinUrl) {
          updates.linkedinUrl = sighting.linkedinUrl;
        }

        // Fill in blanks
        if (!contact.email && sighting.email) updates.email = sighting.email;
        if (!contact.role && sighting.role) updates.role = sighting.role;

        // Conditionally update company (for job changes)
        if (body.updateCompany && sighting.company) {
          updates.company = sighting.company;
          if (sighting.role) updates.role = sighting.role;
        } else if (!contact.company && sighting.company) {
          updates.company = sighting.company;
        }

        if (Object.keys(updates).length > 0) {
          await prisma.contact.update({
            where: { id: sighting.contactId },
            data: updates,
          });
        }
      }

      await prisma.contactSighting.update({
        where: { id: body.sightingId },
        data: { resolution: "MANUALLY_MERGED", resolvedAt: new Date() },
      });

      return NextResponse.json({ resolution: "MANUALLY_MERGED" });
    }

    if (body.action === "create") {
      if (!sighting.name) {
        return NextResponse.json(
          { error: "Sighting has no name" },
          { status: 400 },
        );
      }

      const newContact = await prisma.contact.create({
        data: {
          userId: session.user.id,
          name: sighting.name,
          email: sighting.email,
          phone: sighting.phone,
          company: sighting.company,
          role: sighting.role,
          linkedinUrl: sighting.linkedinUrl,
          source: "LINKEDIN",
          tier: "ACQUAINTANCE",
          importedAt: new Date(),
        },
      });

      await prisma.contactSighting.update({
        where: { id: body.sightingId },
        data: {
          resolution: "NEW_CONTACT",
          contactId: newContact.id,
          resolvedAt: new Date(),
        },
      });

      return NextResponse.json({ resolution: "NEW_CONTACT", contactId: newContact.id });
    }

    // dismiss
    await prisma.contactSighting.update({
      where: { id: body.sightingId },
      data: { resolution: "MANUALLY_REJECTED", resolvedAt: new Date() },
    });

    return NextResponse.json({ resolution: "MANUALLY_REJECTED" });
  } catch (error) {
    console.error("[PATCH /api/import/linkedin/review]", error);
    return NextResponse.json(
      { error: "Failed to resolve review item" },
      { status: 500 },
    );
  }
}
