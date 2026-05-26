-- BACKFILL (M0.3, 2026-05-26): this migration row was already in
-- _prisma_migrations but the SQL file never made it into source.
-- DDL below was captured from the live DB so fresh clones get the
-- table + column identically to production.

CREATE TABLE "MergeLog" (
  "id"                TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "primaryContactId"  TEXT NOT NULL,
  "mergedContactIds"  TEXT[],
  "snapshotJson"      JSONB NOT NULL,
  "fieldsAdded"       JSONB NOT NULL,
  "conflictsResolved" JSONB NOT NULL,
  "mergedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undoneAt"          TIMESTAMP(3),

  CONSTRAINT "MergeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MergeLog_userId_mergedAt_idx"
  ON "MergeLog"("userId", "mergedAt");

CREATE INDEX "MergeLog_primaryContactId_idx"
  ON "MergeLog"("primaryContactId");

ALTER TABLE "MergeLog"
  ADD CONSTRAINT "MergeLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Soft-delete column on Contact (rows kept for MergeLog provenance).
ALTER TABLE "Contact"
  ADD COLUMN "deletedAt" TIMESTAMP(3);
