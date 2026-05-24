/**
 * Walk every circle that has googleSyncEnabled=true and push its current
 * membership out to Google. Runs nightly via the crontab in
 * worker/index.ts. Individual circle failures are logged and skipped
 * so one bad circle doesn't block the rest.
 */
import type { Task } from "graphile-worker";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { syncCircleToGoogle } from "../../src/lib/circle-google-sync";

const circleGoogleSync: Task = async (_payload, helpers) => {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    const circles = await prisma.circle.findMany({
      where: { googleSyncEnabled: true },
      select: { id: true, userId: true, name: true },
    });

    if (circles.length === 0) {
      helpers.logger.debug("No circles have Google sync enabled.");
      return;
    }

    helpers.logger.info(`Syncing ${circles.length} circle(s) to Google.`);

    let ok = 0;
    let failed = 0;
    for (const c of circles) {
      try {
        const r = await syncCircleToGoogle(c.userId, c.id);
        helpers.logger.info(
          `  ${c.name}: +${r.added} -${r.removed} (${r.unresolved} unresolved)`,
        );
        ok++;
      } catch (err) {
        helpers.logger.error(
          `  ${c.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
        failed++;
      }
    }

    helpers.logger.info(`Done. ${ok} ok, ${failed} failed.`);
  } finally {
    await prisma.$disconnect();
  }
};

export default circleGoogleSync;
