import pg from "pg";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  // Delete duplicate interactions, keeping the earliest (by createdAt) for each (userId, sourceId)
  const result = await client.query(`
    DELETE FROM "Interaction"
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY "userId", "sourceId"
          ORDER BY "createdAt"
        ) as rn
        FROM "Interaction"
        WHERE "sourceId" IS NOT NULL
      ) sub
      WHERE rn > 1
    )
  `);

  console.log(`Deleted ${result.rowCount} duplicate interactions`);

  // Verify no dupes remain
  const verify = await client.query(`
    SELECT "userId", "sourceId", COUNT(*) as cnt
    FROM "Interaction"
    WHERE "sourceId" IS NOT NULL
    GROUP BY "userId", "sourceId"
    HAVING COUNT(*) > 1
    LIMIT 5
  `);
  console.log(`Remaining duplicates: ${verify.rows.length}`);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
