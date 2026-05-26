-- BACKFILL (M0.3, 2026-05-26): this migration row was already in
-- _prisma_migrations but the SQL file never made it into source.
-- DDL below was captured from the live DB so fresh clones get the
-- table identically to production.

CREATE TYPE "AiModel" AS ENUM (
  'HAIKU',
  'SONNET'
);

CREATE TYPE "AiFeature" AS ENUM (
  'DRAFT',
  'CLASSIFICATION',
  'BRIEF',
  'CHAT',
  'ACTIONS',
  'INSIGHTS',
  'ENRICHMENT'
);

CREATE TABLE "ApiUsageLog" (
  "id"               TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "model"            "AiModel" NOT NULL,
  "feature"          "AiFeature" NOT NULL,
  "promptTokens"     INTEGER NOT NULL,
  "completionTokens" INTEGER NOT NULL,
  "totalTokens"      INTEGER NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ApiUsageLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApiUsageLog_userId_createdAt_idx"
  ON "ApiUsageLog"("userId", "createdAt");

ALTER TABLE "ApiUsageLog"
  ADD CONSTRAINT "ApiUsageLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
