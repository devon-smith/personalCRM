-- Durable telemetry for Gmail/Calendar sync runs across cron, webhook,
-- manual, and browser-fallback triggers.
CREATE TABLE "SyncRun" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "itemsProcessed" INTEGER,
  "providerCalls" INTEGER,
  "error" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SyncRun_userId_source_startedAt_idx"
  ON "SyncRun"("userId", "source", "startedAt" DESC);

CREATE INDEX "SyncRun_source_trigger_startedAt_idx"
  ON "SyncRun"("source", "trigger", "startedAt" DESC);

CREATE INDEX "SyncRun_status_startedAt_idx"
  ON "SyncRun"("status", "startedAt" DESC);

ALTER TABLE "SyncRun"
  ADD CONSTRAINT "SyncRun_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
