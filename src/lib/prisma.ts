import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function isWorkerRuntime(): boolean {
  return (
    process.env.CRM_WORKER_RUNTIME === "true" ||
    process.argv.some((arg) => /(?:^|[/\\])worker[/\\]index\.(?:ts|js)$/.test(arg))
  );
}

function createPrismaClient() {
  const workerRuntime = isWorkerRuntime();
  const connectionString =
    workerRuntime
      ? process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL
      : process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      workerRuntime
        ? "WORKER_DATABASE_URL or DATABASE_URL is required for worker Prisma access"
        : "DATABASE_URL is required for Prisma access",
    );
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// Lazy singleton. Worker modules import shared app helpers before the
// worker entrypoint finishes setting dotenv/runtime flags. Proxying the
// export defers PrismaClient construction until first property access,
// by which time the web app has DATABASE_URL or the worker has
// CRM_WORKER_RUNTIME plus WORKER_DATABASE_URL populated.
function getInstance(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const real = getInstance();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
