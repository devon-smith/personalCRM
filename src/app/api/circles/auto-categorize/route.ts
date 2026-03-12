import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Frequency tiers based on interactions in the last 90 days.
 * Each tier maps to a circle with a suggested follow-up cadence.
 */
const FREQUENCY_TIERS = [
  {
    name: "Weekly",
    minInteractions: 12, // ~3+/week over 90 days
    color: "#10B981",
    icon: "heart",
    followUpDays: 7,
    description: "People you talk to multiple times a week",
  },
  {
    name: "Regular",
    minInteractions: 5, // ~1-2/week
    color: "#3B82F6",
    icon: "users",
    followUpDays: 14,
    description: "People you talk to weekly",
  },
  {
    name: "Monthly",
    minInteractions: 2,
    color: "#F59E0B",
    icon: "calendar",
    followUpDays: 30,
    description: "People you talk to a few times a month",
  },
  {
    name: "Occasional",
    minInteractions: 1,
    color: "#8B5CF6",
    icon: "clock",
    followUpDays: 60,
    description: "People you've talked to at least once recently",
  },
] as const;

export interface AutoCategorizeResult {
  circlesCreated: number;
  contactsAssigned: number;
  tiers: {
    name: string;
    circleId: string;
    contactCount: number;
  }[];
  uncategorized: number;
}

/**
 * GET — Preview what auto-categorize would do (dry run).
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const preview = await computeCategorization(session.user.id, false);
    return NextResponse.json(preview);
  } catch (error) {
    console.error("[GET /api/circles/auto-categorize]", error);
    return NextResponse.json(
      { error: "Failed to compute categorization" },
      { status: 500 },
    );
  }
}

/**
 * POST — Execute auto-categorization: create circles and assign contacts.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await computeCategorization(session.user.id, true);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/circles/auto-categorize]", error);
    return NextResponse.json(
      { error: "Failed to auto-categorize contacts" },
      { status: 500 },
    );
  }
}

interface ContactFrequency {
  contactId: string;
  interactionCount: number;
}

async function computeCategorization(
  userId: string,
  apply: boolean,
): Promise<AutoCategorizeResult> {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // Count interactions per contact in the last 90 days
  const interactionCounts = await prisma.interaction.groupBy({
    by: ["contactId"],
    where: {
      userId,
      occurredAt: { gte: ninetyDaysAgo },
    },
    _count: { _all: true },
  });

  const frequencyMap = new Map<string, number>();
  for (const row of interactionCounts) {
    frequencyMap.set(row.contactId, row._count._all);
  }

  // Get all contacts (to count uncategorized)
  const allContacts = await prisma.contact.findMany({
    where: { userId },
    select: { id: true },
  });

  // Assign contacts to tiers (highest tier wins)
  const tierAssignments: Map<string, ContactFrequency[]> = new Map();
  const assignedIds = new Set<string>();

  for (const tier of FREQUENCY_TIERS) {
    const contacts: ContactFrequency[] = [];
    for (const [contactId, count] of frequencyMap) {
      if (!assignedIds.has(contactId) && count >= tier.minInteractions) {
        contacts.push({ contactId, interactionCount: count });
        assignedIds.add(contactId);
      }
    }
    tierAssignments.set(tier.name, contacts);
  }

  if (!apply) {
    // Dry run — return preview
    const tiers = FREQUENCY_TIERS.map((tier) => ({
      name: tier.name,
      circleId: "",
      contactCount: tierAssignments.get(tier.name)?.length ?? 0,
    }));

    return {
      circlesCreated: tiers.filter((t) => t.contactCount > 0).length,
      contactsAssigned: assignedIds.size,
      tiers,
      uncategorized: allContacts.length - assignedIds.size,
    };
  }

  // Apply — create/find circles and assign contacts
  const existingCircles = await prisma.circle.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  const circlesByName = new Map(existingCircles.map((c) => [c.name, c.id]));
  const circleCount = existingCircles.length;

  let circlesCreated = 0;
  let contactsAssigned = 0;
  const resultTiers: AutoCategorizeResult["tiers"] = [];

  for (let i = 0; i < FREQUENCY_TIERS.length; i++) {
    const tier = FREQUENCY_TIERS[i];
    const contacts = tierAssignments.get(tier.name) ?? [];
    if (contacts.length === 0) {
      resultTiers.push({ name: tier.name, circleId: "", contactCount: 0 });
      continue;
    }

    // Find or create circle
    let circleId = circlesByName.get(tier.name);
    if (!circleId) {
      // Check 15-circle limit
      if (circleCount + circlesCreated >= 15) {
        resultTiers.push({ name: tier.name, circleId: "", contactCount: 0 });
        continue;
      }

      const circle = await prisma.circle.create({
        data: {
          userId,
          name: tier.name,
          color: tier.color,
          icon: tier.icon,
          followUpDays: tier.followUpDays,
          sortOrder: circleCount + circlesCreated,
        },
      });
      circleId = circle.id;
      circlesCreated++;
    }

    // Add contacts to circle (skip duplicates)
    const result = await prisma.contactCircle.createMany({
      data: contacts.map((c) => ({
        contactId: c.contactId,
        circleId,
      })),
      skipDuplicates: true,
    });
    contactsAssigned += result.count;

    resultTiers.push({
      name: tier.name,
      circleId,
      contactCount: contacts.length,
    });
  }

  return {
    circlesCreated,
    contactsAssigned,
    tiers: resultTiers,
    uncategorized: allContacts.length - assignedIds.size,
  };
}
