import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { privateCacheHeaders } from "@/lib/http/cache";
import { prisma } from "@/lib/prisma";
import {
  buildContactListQuery,
  ContactListQueryError,
  contactListSelect,
} from "@/lib/contact-list-query";

const READ_CACHE_HEADERS = privateCacheHeaders(30, 120);

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { where, orderBy, take } = buildContactListQuery(
      req.nextUrl.searchParams,
      session.user.id,
    );

    const [contacts, circles, totalPendingDuplicates] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy,
        take,
        select: contactListSelect,
      }),
      prisma.circle.findMany({
        where: { userId: session.user.id },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, color: true },
      }),
      prisma.contactSighting.count({
        where: { userId: session.user.id, resolution: "REVIEW_NEEDED" },
      }),
    ]);

    return NextResponse.json(
      { contacts, circles, totalPendingDuplicates },
      { headers: READ_CACHE_HEADERS },
    );
  } catch (error) {
    if (error instanceof ContactListQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("[GET /api/people/bootstrap]", error);
    return NextResponse.json(
      { error: "Failed to load people" },
      { status: 500 },
    );
  }
}
