import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

// Lazy singleton. The worker's `import "dotenv/config"` lands env vars in
// the process AFTER our task imports have already resolved, so eagerly
// instantiating the client at module init captures an empty
// DATABASE_URL and pg falls back to the OS-user database. Proxying the
// export defers PrismaClient construction until first property access —
// by which time dotenv has settled and DATABASE_URL is populated.
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
