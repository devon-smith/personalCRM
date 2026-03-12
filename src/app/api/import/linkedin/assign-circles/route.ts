import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeCompany, companiesMatch } from "@/lib/name-utils";

interface CircleAssignment {
  company: string;
  circleId: string;
}

/**
 * POST — Assign recently imported LinkedIn contacts to circles by company.
 * Finds contacts with source=LINKEDIN whose company matches the given company name,
 * then adds them to the specified circle.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { assignments } = (await req.json()) as { assignments: CircleAssignment[] };

    if (!Array.isArray(assignments) || assignments.length === 0) {
      return NextResponse.json({ error: "No assignments provided" }, { status: 400 });
    }

    const userId = session.user.id;

    // Verify all circles belong to the user
    const circleIds = [...new Set(assignments.map((a) => a.circleId))];
    const circles = await prisma.circle.findMany({
      where: { id: { in: circleIds }, userId },
      select: { id: true },
    });
    const validCircleIds = new Set(circles.map((c) => c.id));

    // Get all LinkedIn-sourced contacts for this user
    const linkedInContacts = await prisma.contact.findMany({
      where: { userId, source: "LINKEDIN" },
      select: { id: true, company: true },
    });

    let totalAssigned = 0;

    for (const assignment of assignments) {
      if (!validCircleIds.has(assignment.circleId)) continue;

      // Find contacts whose company matches this assignment's company
      const matchingContacts = linkedInContacts.filter((c) => {
        if (!c.company) return false;
        return companiesMatch(c.company, assignment.company);
      });

      if (matchingContacts.length === 0) continue;

      const result = await prisma.contactCircle.createMany({
        data: matchingContacts.map((c) => ({
          contactId: c.id,
          circleId: assignment.circleId,
        })),
        skipDuplicates: true,
      });

      totalAssigned += result.count;
    }

    return NextResponse.json({ assigned: totalAssigned });
  } catch (error) {
    console.error("[POST /api/import/linkedin/assign-circles]", error);
    return NextResponse.json(
      { error: "Failed to assign circles" },
      { status: 500 },
    );
  }
}
