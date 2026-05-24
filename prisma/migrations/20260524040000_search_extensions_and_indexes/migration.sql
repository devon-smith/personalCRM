-- Universal contact search foundations: trigram fuzzy + vector embeddings.
--
-- pg_trgm: GIN trigram indexes power similarity-based fuzzy search across
--   Contact.name / .email / .company. Handles typos and partial matches
--   without needing a full-text search index.
-- pgvector: cosine-similarity search over a 384-dim embedding column for
--   semantic queries ("Wharton lunch last spring"). Backfill follows in a
--   separate commit.
--
-- On Supabase both extensions are pre-approved. CREATE EXTENSION IF NOT
-- EXISTS is idempotent so re-running this migration on an env where the
-- extension was enabled via the Dashboard won't fail.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- Trigram GIN indexes for fuzzy similarity search.
-- Using gin_trgm_ops so % operator (similarity) and word_similarity can
-- both use the index.
CREATE INDEX IF NOT EXISTS "Contact_name_trgm_idx"
  ON "Contact" USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Contact_email_trgm_idx"
  ON "Contact" USING gin (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Contact_company_trgm_idx"
  ON "Contact" USING gin (company gin_trgm_ops);

-- Embedding column. 384 dims matches BGE-small / similar lightweight
-- sentence-transformer models. Nullable until backfilled.
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "embedding" vector(384);
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "embeddingUpdatedAt" TIMESTAMP(3);

-- IVFFlat index for approximate nearest-neighbor search. Skipped here —
-- it requires data to be present before it's worth building, and
-- pgvector recommends building the index AFTER backfilling embeddings.
-- The embeddings backfill script will create the index when it finishes.
