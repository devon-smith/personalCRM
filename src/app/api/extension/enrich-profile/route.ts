import { NextResponse } from "next/server";
import { authExtension } from "@/lib/extension-auth";
import { prisma } from "@/lib/prisma";

interface EnrichProfileBody {
  linkedinUrl: string;
  aboutText: string | null;
  currentExperience: {
    company: string;
    role: string;
    startDate: string | null;
  } | null;
  education: {
    school: string;
    degree: string | null;
    year: string | null;
  } | null;
  mutualConnections: number | null;
  contactInfoEmails: string[];
  contactInfoPhones: string[];
}

/**
 * POST /api/extension/enrich-profile
 * Merges enrichment data from LinkedIn profile page into existing contact.
 * Fills null fields, adds emails/phones, stores about text as note.
 */
export async function POST(request: Request) {
  try {
    const authResult = await authExtension(request);
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.userId;

    const body = (await request.json()) as EnrichProfileBody;
    if (!body.linkedinUrl) {
      return NextResponse.json(
        { error: "linkedinUrl required" },
        { status: 400 },
      );
    }

    const normalized = body.linkedinUrl
      .split("?")[0]
      .replace(/\/overlay\/.*$/, "")
      .replace(/\/+$/, "");

    const contact = await prisma.contact.findFirst({
      where: { userId, linkedinUrl: { startsWith: normalized } },
      select: {
        id: true,
        company: true,
        role: true,
        notes: true,
        additionalEmails: true,
        additionalPhones: true,
      },
    });

    if (!contact) {
      return NextResponse.json({ enriched: false, reason: "not_found" });
    }

    const updates: Record<string, unknown> = {};
    const enrichments: string[] = [];

    // Enrich company/role from experience if currently empty
    if (body.currentExperience) {
      if (!contact.company && body.currentExperience.company) {
        updates.company = body.currentExperience.company;
        enrichments.push("company");
      }
      if (!contact.role && body.currentExperience.role) {
        updates.role = body.currentExperience.role;
        enrichments.push("role");
      }
    }

    // Add new emails (dedup case-insensitive)
    if (body.contactInfoEmails.length > 0) {
      const existingEmails = new Set(
        contact.additionalEmails.map((e) => e.toLowerCase()),
      );
      const newEmails = body.contactInfoEmails.filter(
        (e) => !existingEmails.has(e.toLowerCase()),
      );
      if (newEmails.length > 0) {
        updates.additionalEmails = [...contact.additionalEmails, ...newEmails];
        enrichments.push(`${newEmails.length} email(s)`);
      }
    }

    // Add new phones (dedup by last 10 digits)
    if (body.contactInfoPhones.length > 0) {
      const existingDigits = new Set(
        contact.additionalPhones.map((p) => p.replace(/\D/g, "").slice(-10)),
      );
      const newPhones = body.contactInfoPhones.filter(
        (p) => !existingDigits.has(p.replace(/\D/g, "").slice(-10)),
      );
      if (newPhones.length > 0) {
        updates.additionalPhones = [...contact.additionalPhones, ...newPhones];
        enrichments.push(`${newPhones.length} phone(s)`);
      }
    }

    // Store about text as a note (only if not already stored)
    if (body.aboutText && body.aboutText.length > 10) {
      const bioPrefix = "LinkedIn bio:";
      const hasExistingBio = contact.notes?.includes(bioPrefix);
      if (!hasExistingBio) {
        const bioNote = `${bioPrefix} ${body.aboutText.slice(0, 300)}`;
        updates.notes = contact.notes
          ? `${contact.notes}\n\n${bioNote}`
          : bioNote;
        enrichments.push("bio");
      }
    }

    // Store education as a note if provided and not already in notes
    if (body.education?.school) {
      const eduPrefix = "Education:";
      const hasExistingEdu = contact.notes?.includes(eduPrefix);
      if (!hasExistingEdu) {
        const parts = [body.education.school];
        if (body.education.degree) parts.push(body.education.degree);
        if (body.education.year) parts.push(body.education.year);
        const eduNote = `${eduPrefix} ${parts.join(", ")}`;
        const currentNotes =
          typeof updates.notes === "string" ? updates.notes : contact.notes;
        updates.notes = currentNotes
          ? `${currentNotes}\n${eduNote}`
          : eduNote;
        enrichments.push("education");
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: updates,
      });
    }

    return NextResponse.json({
      enriched: enrichments.length > 0,
      enrichments,
      contactId: contact.id,
    });
  } catch (error) {
    console.error("[POST /api/extension/enrich-profile]", error);
    return NextResponse.json(
      { error: "Failed to enrich profile" },
      { status: 500 },
    );
  }
}
