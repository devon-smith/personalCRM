-- OAuth resilience: per-account reconnect state
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "needsReconnect" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "lastRefreshAt" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "lastRefreshError" TEXT;

-- Structured log of every refresh / sync outcome so failures are diagnosable.
-- Replaces silent console.error in the refresh path.
CREATE TABLE IF NOT EXISTS "SyncLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accountId" TEXT,
  "kind" TEXT NOT NULL,
  "message" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SyncLog_userId_createdAt_idx"
  ON "SyncLog"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "SyncLog_accountId_createdAt_idx"
  ON "SyncLog"("accountId", "createdAt" DESC);
