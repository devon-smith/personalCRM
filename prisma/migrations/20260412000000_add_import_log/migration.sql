-- BACKFILL (M0.3, 2026-05-26): this migration row was already in
-- _prisma_migrations but the SQL file never made it into source.
-- DDL below was captured from the live DB so fresh clones get the
-- table identically to production.

CREATE TYPE "ImportSource" AS ENUM (
  'LINKEDIN_CONNECTIONS',
  'LINKEDIN_MESSAGES',
  'GOOGLE_CONTACTS'
);

CREATE TYPE "ImportStatus" AS ENUM (
  'SUCCESS',
  'PARTIAL',
  'FAILED'
);

CREATE TABLE "ImportLog" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "source"      "ImportSource" NOT NULL,
  "importedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordCount" INTEGER NOT NULL,
  "status"      "ImportStatus" NOT NULL DEFAULT 'SUCCESS',

  CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportLog_userId_source_idx"
  ON "ImportLog"("userId", "source");

ALTER TABLE "ImportLog"
  ADD CONSTRAINT "ImportLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
