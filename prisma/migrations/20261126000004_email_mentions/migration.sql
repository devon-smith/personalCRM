-- M7.2 expansion: per-email mention extraction.
-- Populated by the mention-extraction worker (Claude Haiku entity
-- recognition over email bodies). Feeds the `mentioned` edge type
-- in ContactEdge.

ALTER TABLE "EmailMessage"
  ADD COLUMN "mentionedContactIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "mentionsProcessedAt" TIMESTAMP(3);

-- Lets the worker quickly find rows where mentionsProcessedAt IS NULL.
CREATE INDEX "EmailMessage_userId_mentionsProcessedAt_idx"
  ON "EmailMessage"("userId", "mentionsProcessedAt");
