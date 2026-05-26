-- BACKFILL (M0.3, 2026-05-26): this migration row was already in
-- _prisma_migrations but the SQL file never made it into source.
-- DDL below was captured from the live DB so fresh clones get the
-- table identically to production.

CREATE TABLE "MeetingPersonSummaryCache" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "contactId"  TEXT,
  "fetchedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "crmContext" JSONB,
  "webSummary" TEXT,

  CONSTRAINT "MeetingPersonSummaryCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MeetingPersonSummaryCache_name_contactId_key"
  ON "MeetingPersonSummaryCache"("name", "contactId");

CREATE INDEX "MeetingPersonSummaryCache_fetchedAt_idx"
  ON "MeetingPersonSummaryCache"("fetchedAt");

ALTER TABLE "MeetingPersonSummaryCache"
  ADD CONSTRAINT "MeetingPersonSummaryCache_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
