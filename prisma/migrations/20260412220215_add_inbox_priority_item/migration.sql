-- BACKFILL (M0.3, 2026-05-26): this migration row was already in
-- _prisma_migrations but the SQL file never made it into source.
-- DDL below was captured from the live DB so fresh clones get the
-- table identically to production.

CREATE TABLE "InboxPriorityItem" (
  "id"                     TEXT NOT NULL,
  "userId"                 TEXT NOT NULL,
  "contactId"              TEXT NOT NULL,
  "threadId"               TEXT NOT NULL,
  "subject"                TEXT,
  "snippet"                TEXT,
  "receivedAt"             TIMESTAMP(3) NOT NULL,
  "senderInteractionCount" INTEGER NOT NULL DEFAULT 0,
  "isActive"               BOOLEAN NOT NULL DEFAULT TRUE,
  "dismissedUntil"         TIMESTAMP(3),

  CONSTRAINT "InboxPriorityItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboxPriorityItem_userId_threadId_key"
  ON "InboxPriorityItem"("userId", "threadId");

CREATE INDEX "InboxPriorityItem_userId_isActive_idx"
  ON "InboxPriorityItem"("userId", "isActive");

ALTER TABLE "InboxPriorityItem"
  ADD CONSTRAINT "InboxPriorityItem_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InboxPriorityItem"
  ADD CONSTRAINT "InboxPriorityItem_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
