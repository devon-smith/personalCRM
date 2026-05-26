-- BACKFILL (M0.3, 2026-05-26): this migration row was already in
-- _prisma_migrations but the SQL file never made it into source.
-- DDL below was captured from the live DB so fresh clones get the
-- table identically to production.

CREATE TABLE "DailyPriorityQueue" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "contactId"      TEXT NOT NULL,
  "score"          INTEGER NOT NULL,
  "triggerType"    TEXT NOT NULL,
  "triggerContext" JSONB NOT NULL,
  "generatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actionedAt"     TIMESTAMP(3),
  "snoozedUntil"   TIMESTAMP(3),
  "dismissedAt"    TIMESTAMP(3),

  CONSTRAINT "DailyPriorityQueue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DailyPriorityQueue_userId_generatedAt_idx"
  ON "DailyPriorityQueue"("userId", "generatedAt");

CREATE INDEX "DailyPriorityQueue_userId_actionedAt_idx"
  ON "DailyPriorityQueue"("userId", "actionedAt");

ALTER TABLE "DailyPriorityQueue"
  ADD CONSTRAINT "DailyPriorityQueue_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DailyPriorityQueue"
  ADD CONSTRAINT "DailyPriorityQueue_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
