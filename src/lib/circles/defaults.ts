import { prisma } from "@/lib/prisma";
import { DEFAULT_CIRCLES } from "./templates";

export type { CircleTemplate } from "./templates";
export { CIRCLE_TEMPLATES, DEFAULT_CIRCLES } from "./templates";

/** Create circles for a user from selected templates */
export async function createCirclesForUser(
  userId: string,
  circles: Array<{ name: string; color: string; icon: string; followUpDays: number }>,
): Promise<void> {
  await prisma.circle.createMany({
    data: circles.map((c, i) => ({
      userId,
      name: c.name,
      color: c.color,
      icon: c.icon,
      followUpDays: c.followUpDays,
      sortOrder: i,
      isDefault: false,
    })),
    skipDuplicates: true,
  });
}

/** Create the 3 default circles for a user (backward compat with tiers) */
export async function createDefaultCircles(userId: string): Promise<void> {
  await prisma.circle.createMany({
    data: DEFAULT_CIRCLES.map((c, i) => ({
      userId,
      name: c.name,
      color: c.color,
      icon: c.icon,
      followUpDays: c.followUpDays,
      sortOrder: i,
      isDefault: true,
    })),
    skipDuplicates: true,
  });
}
