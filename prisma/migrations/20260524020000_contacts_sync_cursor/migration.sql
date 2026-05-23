-- Per-account People API sync cursor. Stores nextSyncToken so subsequent
-- syncs only fetch deltas instead of the full connection list.
CREATE TABLE IF NOT EXISTS "ContactsSyncCursor" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "nextSyncToken" TEXT,
  "lastSyncAt" TIMESTAMP(3),
  "lastFullSyncAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactsSyncCursor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContactsSyncCursor_userId_accountId_key"
  ON "ContactsSyncCursor"("userId", "accountId");
CREATE INDEX IF NOT EXISTS "ContactsSyncCursor_userId_idx"
  ON "ContactsSyncCursor"("userId");
