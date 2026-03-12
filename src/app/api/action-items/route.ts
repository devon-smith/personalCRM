import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { extractActionItems } from "@/lib/gmail/extract-actions";
import type { ExtractResult } from "@/lib/gmail/extract-actions";

export type { ExtractResult };

export interface ActionItemResponse {
  id: string;
  title: string;
  context: string | null;
  status: "OPEN" | "DONE" | "DISMISSED";
  dueDate: string | null;
  extractedAt: string;
  contact: { id: string; name: string } | null;
}

/** GET — List open action items */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const items = await prisma.actionItem.findMany({
      where: { userId: session.user.id, status: "OPEN" },
      include: {
        contact: { select: { id: true, name: true } },
      },
      orderBy: [
        { dueDate: "asc" },
        { extractedAt: "desc" },
      ],
      take: 30,
    });

    const response: ActionItemResponse[] = items.map((item) => ({
      id: item.id,
      title: item.title,
      context: item.context,
      status: item.status,
      dueDate: item.dueDate?.toISOString() ?? null,
      extractedAt: item.extractedAt.toISOString(),
      contact: item.contact ? { id: item.contact.id, name: item.contact.name } : null,
    }));

    return NextResponse.json({ items: response });
  } catch (error) {
    console.error("Action items GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch action items" },
      { status: 500 },
    );
  }
}

/** POST — Trigger extraction from Gmail */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await extractActionItems(session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Action item extraction error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to extract action items",
      },
      { status: 500 },
    );
  }
}
