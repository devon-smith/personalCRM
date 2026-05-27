-- M0.x.9: follow-up question threading.
--
-- A query asked as a follow-up to a previous answer carries the
-- parent id here. /ask top-level history hides rows with a non-null
-- parentQueryId; /ask/[id] renders parent + children chronologically.
-- followUpCount is denormalized so the history list can render the
-- "+N follow-ups" badge without a per-row count query.

ALTER TABLE "SavedQuery"
  ADD COLUMN "parentQueryId" TEXT,
  ADD COLUMN "followUpCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SavedQuery"
  ADD CONSTRAINT "SavedQuery_parentQueryId_fkey"
  FOREIGN KEY ("parentQueryId") REFERENCES "SavedQuery"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- For /ask/[id]: pull children of a parent in chronological order.
CREATE INDEX "SavedQuery_parentQueryId_createdAt_idx"
  ON "SavedQuery"("parentQueryId", "createdAt");
