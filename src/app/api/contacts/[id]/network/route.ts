import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findNeighbors } from "@/lib/intelligence/graph-traverse";

/**
 * GET /api/contacts/:id/network
 *
 * Returns the contacts directly connected to this one via ContactEdge
 * (M7.2). Powers the "People who know X" section on the contact panel.
 *
 * Query params:
 *   - types: comma-separated edge types ("mutual_thread,same_org")
 *   - minStrength: float 0-1 (default 0.3)
 *   - limit: int (default 25)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  // Ownership check.
  const exists = await prisma.contact.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!exists) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const typesParam = url.searchParams.get("types");
  const edgeTypes = typesParam
    ? typesParam.split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;
  const minStrength = url.searchParams.get("minStrength");
  const limit = url.searchParams.get("limit");

  const neighbors = await findNeighbors({
    prisma,
    userId: session.user.id,
    contactId: id,
    edgeTypes,
    minStrength: minStrength ? parseFloat(minStrength) : undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
  });

  return NextResponse.json({ neighbors });
}
