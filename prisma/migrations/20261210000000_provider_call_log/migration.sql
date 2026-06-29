CREATE TABLE "ProviderCallLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "provider" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "feature" TEXT NOT NULL,
  "model" TEXT,
  "callCount" INTEGER NOT NULL DEFAULT 1,
  "itemCount" INTEGER,
  "tokensIn" INTEGER,
  "tokensOut" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'success',
  "latencyMs" INTEGER,
  "error" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProviderCallLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderCallLog_userId_createdAt_idx"
  ON "ProviderCallLog"("userId", "createdAt" DESC);

CREATE INDEX "ProviderCallLog_provider_createdAt_idx"
  ON "ProviderCallLog"("provider", "createdAt" DESC);

CREATE INDEX "ProviderCallLog_service_createdAt_idx"
  ON "ProviderCallLog"("service", "createdAt" DESC);

CREATE INDEX "ProviderCallLog_feature_createdAt_idx"
  ON "ProviderCallLog"("feature", "createdAt" DESC);

ALTER TABLE "ProviderCallLog"
  ADD CONSTRAINT "ProviderCallLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
