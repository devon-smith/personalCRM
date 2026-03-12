import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createDefaultCircles } from "@/lib/circles/defaults";

interface CircleInput {
  name: string;
  color: string;
  icon: string;
  followUpDays: number;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const body = (await req.json()) as { circles?: CircleInput[] };
    const circles = body.circles ?? [];

    // Validate circle count
    if (circles.length > 15) {
      return NextResponse.json(
        { error: "Maximum 15 circles allowed" },
        { status: 400 },
      );
    }

    // Validate circle names
    for (const c of circles) {
      if (!c.name || c.name.trim().length === 0) {
        return NextResponse.json(
          { error: "Circle names cannot be empty" },
          { status: 400 },
        );
      }
    }

    // Delete any existing circles from previous attempts
    await prisma.circle.deleteMany({ where: { userId } });

    // Create selected circles (or defaults)
    const circleData =
      circles.length > 0
        ? circles.map((c, i) => ({
            userId,
            name: c.name.trim(),
            color: c.color,
            icon: c.icon,
            followUpDays: c.followUpDays,
            sortOrder: i,
            isDefault: false,
          }))
        : [
            { userId, name: "Inner Circle", color: "#111827", icon: "heart", followUpDays: 14, sortOrder: 0, isDefault: true },
            { userId, name: "Professional", color: "#6B7280", icon: "briefcase", followUpDays: 30, sortOrder: 1, isDefault: true },
            { userId, name: "Acquaintance", color: "#D1D5DB", icon: "users", followUpDays: 90, sortOrder: 2, isDefault: true },
          ];

    await prisma.circle.createMany({ data: circleData, skipDuplicates: true });

    // Mark onboarding as complete
    await prisma.user.update({
      where: { id: userId },
      data: { onboardingCompletedAt: new Date() },
    });

    const response = NextResponse.json({ success: true });

    // Set cookie so middleware doesn't need to query DB
    response.cookies.set("crm-onboarding-complete", "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: "/",
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("Onboarding complete error:", message, stack);
    return NextResponse.json(
      { error: "Failed to complete onboarding", detail: message },
      { status: 500 },
    );
  }
}
