-- BACKFILL (M0.3, 2026-05-26): this migration row was already in
-- _prisma_migrations but the SQL file never made it into source.
-- DDL below was captured from the live DB so fresh clones get the
-- tables identically to production.

CREATE TABLE "MeetingPrepCache" (
  "id"                   TEXT NOT NULL,
  "contactId"            TEXT NOT NULL,
  "generatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "historySummary"       TEXT NOT NULL,
  "talkingPoints"        TEXT[],
  "lastMentionedBullets" TEXT[],

  CONSTRAINT "MeetingPrepCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MeetingPrepCache_contactId_key"
  ON "MeetingPrepCache"("contactId");

CREATE INDEX "MeetingPrepCache_contactId_generatedAt_idx"
  ON "MeetingPrepCache"("contactId", "generatedAt");

ALTER TABLE "MeetingPrepCache"
  ADD CONSTRAINT "MeetingPrepCache_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MeetingPrepWebCache" (
  "id"         TEXT NOT NULL,
  "contactId"  TEXT NOT NULL,
  "searchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "findings"   JSONB NOT NULL,

  CONSTRAINT "MeetingPrepWebCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MeetingPrepWebCache_contactId_key"
  ON "MeetingPrepWebCache"("contactId");

CREATE INDEX "MeetingPrepWebCache_contactId_searchedAt_idx"
  ON "MeetingPrepWebCache"("contactId", "searchedAt");

ALTER TABLE "MeetingPrepWebCache"
  ADD CONSTRAINT "MeetingPrepWebCache_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
