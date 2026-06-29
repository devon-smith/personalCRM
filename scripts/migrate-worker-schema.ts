/**
 * Initialize or migrate the Graphile Worker schema.
 *
 * The Graphile CLI does not load Next-style `.env.local`, and shell
 * expansion happens before `dotenv` can run. Keep this as a tiny wrapper
 * so local and production worker migration use the same env loading as
 * the worker runtime.
 */
import dotenv from "dotenv";
import { runMigrations } from "graphile-worker";

dotenv.config({ path: ".env.local", override: true, quiet: true });
dotenv.config({ path: ".env", quiet: true });

const connectionString = process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("WORKER_DATABASE_URL or DATABASE_URL is required");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  await runMigrations({
    connectionString: connectionString!,
    maxPoolSize: 1,
  });

  console.log(`Graphile Worker schema migrated on ${summarizeDatabaseUrl(connectionString!)}`);
}

function summarizeDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
  } catch {
    return "configured database";
  }
}
