import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const tier = searchParams.get("tier");
  const tag = searchParams.get("tag");

  const contacts = await prisma.contact.findMany({
    where: {
      userId: session.user.id,
      latitude: { not: null },
      longitude: { not: null },
      ...(tier ? { tier: tier as "INNER_CIRCLE" | "PROFESSIONAL" | "ACQUAINTANCE" } : {}),
      ...(tag ? { tags: { has: tag } } : {}),
    },
    select: {
      id: true,
      name: true,
      company: true,
      role: true,
      tier: true,
      email: true,
      city: true,
      state: true,
      country: true,
      latitude: true,
      longitude: true,
      lastInteraction: true,
    },
  });

  // Also return count of contacts without coordinates for the "Geocode" button
  const ungeocodedCount = await prisma.contact.count({
    where: {
      userId: session.user.id,
      latitude: null,
      OR: [
        { city: { not: null } },
        { state: { not: null } },
        { country: { not: null } },
      ],
    },
  });

  return NextResponse.json({ contacts, ungeocodedCount });
}
