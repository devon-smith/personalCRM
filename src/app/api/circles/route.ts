import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function computeWarmth(
  lastInteraction: Date | null,
  importedAt: Date | null,
  cadenceDays: number,
): "good" | "mid" | "cold" | "none" {
  if (!lastInteraction) {
    return importedAt ? "none" : "cold";
  }
  const daysSince = Math.floor(
    (Date.now() - lastInteraction.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (daysSince <= cadenceDays) return "good";
  if (daysSince <= cadenceDays * 1.5) return "mid";
  return "cold";
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const circles = await prisma.circle.findMany({
      where: { userId: session.user.id },
      include: {
        contacts: {
          include: {
            contact: {
              select: {
                id: true,
                name: true,
                email: true,
                company: true,
                avatarUrl: true,
                lastInteraction: true,
                importedAt: true,
              },
            },
          },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    const result = circles.map((c) => {
      const contacts = c.contacts.map((cc) => {
        const warmth = computeWarmth(
          cc.contact.lastInteraction,
          cc.contact.importedAt,
          c.followUpDays,
        );
        const daysSince = cc.contact.lastInteraction
          ? Math.floor(
              (Date.now() - cc.contact.lastInteraction.getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : null;
        return {
          id: cc.contact.id,
          name: cc.contact.name,
          email: cc.contact.email,
          company: cc.contact.company,
          avatarUrl: cc.contact.avatarUrl,
          warmth,
          daysSince,
        };
      });

      const good = contacts.filter((ct) => ct.warmth === "good").length;
      const mid = contacts.filter((ct) => ct.warmth === "mid").length;
      const cold = contacts.filter((ct) => ct.warmth === "cold").length;

      return {
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon,
        followUpDays: c.followUpDays,
        sortOrder: c.sortOrder,
        isDefault: c.isDefault,
        contacts,
        health: { good, mid, cold },
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("GET /api/circles error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    name: string;
    color?: string;
    icon?: string;
    followUpDays?: number;
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Check limit
  const count = await prisma.circle.count({
    where: { userId: session.user.id },
  });
  if (count >= 15) {
    return NextResponse.json(
      { error: "Maximum 15 circles allowed" },
      { status: 400 },
    );
  }

  const circle = await prisma.circle.create({
    data: {
      userId: session.user.id,
      name: body.name.trim(),
      color: body.color ?? "#6B7280",
      icon: body.icon ?? "users",
      followUpDays: body.followUpDays ?? 30,
      sortOrder: count,
    },
  });

  return NextResponse.json(circle, { status: 201 });
}
