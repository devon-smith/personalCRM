-- M0.x.7: persist every network query with its answer.
--
-- Pre-M0.x.7 saved queries store only the query text. The /queries
-- (now /ask) UI assumed re-running was cheap, so it didn't cache.
-- That broke trust — Jennifer couldn't go back and re-read what the
-- system actually told her. Every query now auto-saves; the existing
-- rows get nullable answer columns and can be re-run on demand.

ALTER TABLE "SavedQuery"
  ADD COLUMN "answer"    TEXT,
  ADD COLUMN "evidence"  JSONB,
  ADD COLUMN "isStarred" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "runCount"  INTEGER NOT NULL DEFAULT 1;

-- Backs the "Starred only" filter in /ask history.
CREATE INDEX "SavedQuery_userId_isStarred_createdAt_idx"
  ON "SavedQuery"("userId", "isStarred", "createdAt" DESC);
