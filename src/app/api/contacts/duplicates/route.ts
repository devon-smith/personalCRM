import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface DuplicateGroup {
  key: string;
  normalizedName: string;
  contacts: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    role: string | null;
    source: string;
    tier: string;
    lastInteraction: string | null;
    interactionCount: number;
    createdAt: string;
  }[];
  matchType: "exact_name" | "name_and_email" | "name_and_phone";
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)\+]/g, "").replace(/^1/, "");
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/** GET — Find duplicate contact groups */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contacts = await prisma.contact.findMany({
      where: { userId: session.user.id },
      include: { _count: { select: { interactions: true } } },
      orderBy: { name: "asc" },
    });

    // Group by normalized name
    const byName = new Map<string, typeof contacts>();
    for (const contact of contacts) {
      const key = normalizeName(contact.name);
      const group = byName.get(key) ?? [];
      group.push(contact);
      byName.set(key, group);
    }

    // Also check phone-based duplicates (different names, same phone)
    const byPhone = new Map<string, typeof contacts>();
    for (const contact of contacts) {
      if (!contact.phone) continue;
      const key = normalizePhone(contact.phone);
      if (key.length < 7) continue; // skip very short numbers
      const group = byPhone.get(key) ?? [];
      group.push(contact);
      byPhone.set(key, group);
    }

    // Also check email-based duplicates
    const byEmail = new Map<string, typeof contacts>();
    for (const contact of contacts) {
      if (!contact.email) continue;
      const key = contact.email.toLowerCase().trim();
      const group = byEmail.get(key) ?? [];
      group.push(contact);
      byEmail.set(key, group);
    }

    const groups: DuplicateGroup[] = [];
    const seenIds = new Set<string>();

    // Name-based duplicates (most common)
    for (const [normalizedName, group] of byName) {
      if (group.length < 2) continue;

      const contactIds = group.map((c) => c.id);
      if (contactIds.every((id) => seenIds.has(id))) continue;
      contactIds.forEach((id) => seenIds.add(id));

      groups.push({
        key: `name:${normalizedName}`,
        normalizedName,
        matchType: "exact_name",
        contacts: group.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          company: c.company,
          role: c.role,
          source: c.source,
          tier: c.tier,
          lastInteraction: c.lastInteraction?.toISOString() ?? null,
          interactionCount: c._count.interactions,
          createdAt: c.createdAt.toISOString(),
        })),
      });
    }

    // Phone-based duplicates (different names, same phone)
    for (const [phone, group] of byPhone) {
      if (group.length < 2) continue;
      const names = new Set(group.map((c) => normalizeName(c.name)));
      if (names.size < 2) continue; // already caught by name match

      const contactIds = group.map((c) => c.id);
      if (contactIds.every((id) => seenIds.has(id))) continue;
      contactIds.forEach((id) => seenIds.add(id));

      groups.push({
        key: `phone:${phone}`,
        normalizedName: group.map((c) => c.name).join(" / "),
        matchType: "name_and_phone",
        contacts: group.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          company: c.company,
          role: c.role,
          source: c.source,
          tier: c.tier,
          lastInteraction: c.lastInteraction?.toISOString() ?? null,
          interactionCount: c._count.interactions,
          createdAt: c.createdAt.toISOString(),
        })),
      });
    }

    // Email-based duplicates (different names, same email)
    for (const [email, group] of byEmail) {
      if (group.length < 2) continue;
      const names = new Set(group.map((c) => normalizeName(c.name)));
      if (names.size < 2) continue;

      const contactIds = group.map((c) => c.id);
      if (contactIds.every((id) => seenIds.has(id))) continue;
      contactIds.forEach((id) => seenIds.add(id));

      groups.push({
        key: `email:${email}`,
        normalizedName: group.map((c) => c.name).join(" / "),
        matchType: "name_and_email",
        contacts: group.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          company: c.company,
          role: c.role,
          source: c.source,
          tier: c.tier,
          lastInteraction: c.lastInteraction?.toISOString() ?? null,
          interactionCount: c._count.interactions,
          createdAt: c.createdAt.toISOString(),
        })),
      });
    }

    // Sort: groups with more duplicates first, then by name
    groups.sort((a, b) => b.contacts.length - a.contacts.length || a.normalizedName.localeCompare(b.normalizedName));

    return NextResponse.json({
      groups,
      totalGroups: groups.length,
      totalDuplicates: groups.reduce((sum, g) => sum + g.contacts.length - 1, 0),
    });
  } catch (error) {
    console.error("[GET /api/contacts/duplicates]", error);
    return NextResponse.json(
      { error: "Failed to find duplicates" },
      { status: 500 },
    );
  }
}
