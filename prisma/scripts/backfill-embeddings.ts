/**
 * One-off backfill for Contact.embedding. Walks every contact missing
 * an embedding (or whose embeddingUpdatedAt predates the source row's
 * updatedAt) and batch-embeds them via Voyage AI.
 *
 * Usage:
 *   VOYAGE_API_KEY=... npx tsx prisma/scripts/backfill-embeddings.ts --dry-run
 *   VOYAGE_API_KEY=... npx tsx prisma/scripts/backfill-embeddings.ts --apply
 *   VOYAGE_API_KEY=... npx tsx prisma/scripts/backfill-embeddings.ts --apply --user-id=<uid>
 *   VOYAGE_API_KEY=... npx tsx prisma/scripts/backfill-embeddings.ts --apply --rebuild
 *
 * Flags:
 *   --dry-run        Count rows, estimate cost, don't call Voyage or write.
 *   --apply          Actually embed + write.
 *   --user-id=<uid>  Limit to one user. Default: all users.
 *   --rebuild        Re-embed all contacts, even ones that already have a
 *                    fresh embedding. Useful after embedding-model changes.
 *
 * Idempotent: re-running --apply only touches contacts whose
 * embedding is missing or stale.
 *
 * After backfill completes, creates an IVFFlat index for fast cosine
 * similarity queries (pgvector docs recommend building the index AFTER
 * data is present so the cluster centroids are well-chosen).
 */
import "dotenv/config";
import { PrismaClient, Prisma } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  buildContactEmbedText,
  embedBatch,
  formatVectorLiteral,
  MAX_BATCH_SIZE,
  VoyageError,
} from "../../src/lib/search/embeddings";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

interface Args {
  apply: boolean;
  dryRun: boolean;
  userId: string | null;
  rebuild: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = { apply: false, dryRun: false, userId: null, rebuild: false };
  for (const a of args) {
    if (a === "--apply") out.apply = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--rebuild") out.rebuild = true;
    else if (a.startsWith("--user-id=")) out.userId = a.split("=")[1];
  }
  if (!out.apply && !out.dryRun) out.dryRun = true;
  return out;
}

interface ContactRow {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  role: string | null;
  company: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  circleNames: string[];
}

async function loadStaleContacts(args: Args): Promise<ContactRow[]> {
  // Pull only the fields we need for the embedding text, plus circle names
  // joined via a subquery so we don't have to hit Prisma N+1.
  const whereClauses: string[] = [];
  const params: unknown[] = [];
  if (args.userId) {
    whereClauses.push(`c."userId" = $${params.length + 1}`);
    params.push(args.userId);
  }
  if (!args.rebuild) {
    // Stale = no embedding OR contact updated after the embedding.
    whereClauses.push(
      `(c."embedding" IS NULL OR c."embeddingUpdatedAt" IS NULL OR c."embeddingUpdatedAt" < c."updatedAt")`,
    );
  }
  const where = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const rows = await prisma.$queryRawUnsafe<ContactRow[]>(`
    SELECT c.id, c."userId", c.name, c.email, c.role, c.company, c.city, c.state, c.country,
           COALESCE(
             ARRAY(
               SELECT cc.name
               FROM "Circle" cc
               JOIN "ContactCircle" jc ON jc."circleId" = cc.id
               WHERE jc."contactId" = c.id
             ),
             ARRAY[]::text[]
           ) AS "circleNames"
    FROM "Contact" c
    ${where}
    ORDER BY c.id
  `, ...params);

  return rows;
}

async function writeEmbedding(
  contactId: string,
  embedding: number[],
): Promise<void> {
  const literal = formatVectorLiteral(embedding);
  // Cast the bound parameter to ::vector — Prisma binds as text.
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "Contact"
    SET "embedding" = ${literal}::vector,
        "embeddingUpdatedAt" = NOW()
    WHERE id = ${contactId}
  `);
}

async function ensureIvfflatIndex(): Promise<void> {
  // Create the IVFFlat ANN index only if it doesn't already exist.
  // lists = sqrt(rows) is the pgvector rule of thumb; we cap so the
  // build doesn't blow up on either tiny or massive tables.
  const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "Contact" WHERE "embedding" IS NOT NULL`,
  );
  const rows = Number(count);
  if (rows < 100) {
    console.log(`Only ${rows} embeddings present — skipping IVFFlat index for now (sequential scan is fast enough).`);
    return;
  }
  const lists = Math.max(10, Math.min(1000, Math.floor(Math.sqrt(rows))));
  console.log(`Building IVFFlat index with lists=${lists} (across ${rows} embeddings)...`);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Contact_embedding_ivfflat_idx"
    ON "Contact"
    USING ivfflat ("embedding" vector_cosine_ops)
    WITH (lists = ${lists})
  `);
  console.log(`Index built.`);
}

async function main() {
  const args = parseArgs();
  console.log(
    `backfill-embeddings: mode=${args.apply ? "APPLY" : "DRY-RUN"}` +
      (args.userId ? ` user=${args.userId}` : "") +
      (args.rebuild ? " rebuild=true" : "") +
      `\n`,
  );

  const contacts = await loadStaleContacts(args);
  console.log(`Found ${contacts.length} contact(s) needing embeddings.`);

  if (contacts.length === 0) {
    console.log("Nothing to do.");
    if (args.apply) await ensureIvfflatIndex();
    return;
  }

  // Rough token estimate: average contact text is ~25 tokens. Voyage-3-lite
  // is $0.02/1M tokens.
  const estimatedTokens = contacts.length * 25;
  const estimatedCost = (estimatedTokens / 1_000_000) * 0.02;
  console.log(
    `Estimated cost: ~${estimatedTokens} tokens ≈ $${estimatedCost.toFixed(4)}\n`,
  );

  if (!args.apply) {
    console.log("Sample contact texts to embed (first 5):");
    for (const c of contacts.slice(0, 5)) {
      console.log("---");
      console.log(buildContactEmbedText(c));
    }
    console.log(`\nDry-run complete. Re-run with --apply to embed.`);
    return;
  }

  if (!process.env.VOYAGE_API_KEY) {
    console.error("VOYAGE_API_KEY not set in environment.");
    process.exit(1);
  }

  // Batch + write
  let processed = 0;
  let totalTokens = 0;
  const start = Date.now();

  for (let i = 0; i < contacts.length; i += MAX_BATCH_SIZE) {
    const batch = contacts.slice(i, i + MAX_BATCH_SIZE);
    const texts = batch.map(buildContactEmbedText);

    let attempt = 0;
    let embeddings: number[][] | null = null;
    let batchTokens = 0;

    while (attempt < 4 && !embeddings) {
      try {
        const batchUserIds = new Set(batch.map((contact) => contact.userId));
        const r = await embedBatch(texts, "document", {
          userId: batchUserIds.size === 1 ? batch[0]?.userId : null,
          feature: "contact_embedding_backfill",
          metadata: {
            batchStart: i,
            batchSize: batch.length,
            userCount: batchUserIds.size,
            rebuild: args.rebuild,
            dryRun: args.dryRun,
          },
        });
        embeddings = r.embeddings;
        batchTokens = r.tokens;
      } catch (err) {
        if (err instanceof VoyageError && err.retryable && attempt < 3) {
          const wait = (attempt + 1) * 2000;
          console.warn(`Batch ${i / MAX_BATCH_SIZE} failed (${err.message}). Retrying in ${wait}ms...`);
          await new Promise((r) => setTimeout(r, wait));
          attempt++;
          continue;
        }
        throw err;
      }
    }

    if (!embeddings) throw new Error("Failed to embed batch after retries");

    // Write sequentially to avoid pg connection exhaustion. The Voyage
    // call is the long pole, not the writes.
    for (let j = 0; j < batch.length; j++) {
      await writeEmbedding(batch[j].id, embeddings[j]);
    }

    processed += batch.length;
    totalTokens += batchTokens;
    const elapsed = (Date.now() - start) / 1000;
    const rate = processed / Math.max(elapsed, 1);
    console.log(
      `  ${processed}/${contacts.length}  (${rate.toFixed(1)}/s, ${totalTokens} tokens, $${((totalTokens / 1_000_000) * 0.02).toFixed(4)})`,
    );
  }

  console.log(
    `\nDone. ${processed} contacts embedded, ${totalTokens} tokens, $${((totalTokens / 1_000_000) * 0.02).toFixed(4)} total cost.`,
  );

  await ensureIvfflatIndex();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
