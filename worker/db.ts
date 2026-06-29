import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

export function getWorkerDatabaseUrl(): string {
  const connectionString =
    process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "WORKER_DATABASE_URL or DATABASE_URL is required for worker database access",
    );
  }
  return connectionString;
}

export function createWorkerPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: getWorkerDatabaseUrl() });
  return new PrismaClient({ adapter });
}
