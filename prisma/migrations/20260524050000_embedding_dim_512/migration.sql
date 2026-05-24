-- Voyage AI's voyage-3-lite returns 512-dim vectors. Resize the embedding
-- column accordingly. The previous migration created it at 384 dims under
-- the assumption of a local sentence-transformer model; switching to
-- Voyage gives meaningfully better quality at a few cents to backfill.
--
-- Safe to alter: no embeddings have been written yet.
ALTER TABLE "Contact" ALTER COLUMN "embedding" TYPE vector(512);
