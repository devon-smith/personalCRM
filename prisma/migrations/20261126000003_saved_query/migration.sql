-- M7.4: Saved natural-language network queries.

CREATE TABLE "SavedQuery" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL,
  "query"     TEXT NOT NULL,
  "title"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastRunAt" TIMESTAMP(3),

  CONSTRAINT "SavedQuery_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SavedQuery_userId_lastRunAt_idx"
  ON "SavedQuery"("userId", "lastRunAt" DESC);
CREATE INDEX "SavedQuery_userId_createdAt_idx"
  ON "SavedQuery"("userId", "createdAt" DESC);
