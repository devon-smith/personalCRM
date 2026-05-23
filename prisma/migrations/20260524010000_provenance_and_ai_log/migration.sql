-- Provenance fields on InboxItem so the evidence chevron has something to show.
ALTER TABLE "InboxItem" ADD COLUMN IF NOT EXISTS "sourceSystem" TEXT;
ALTER TABLE "InboxItem" ADD COLUMN IF NOT EXISTS "sourceRecordIds" JSONB;
ALTER TABLE "InboxItem" ADD COLUMN IF NOT EXISTS "surfacedReason" TEXT;

-- Audit log of every AI generation (drafts, classification, insights).
CREATE TABLE IF NOT EXISTS "AIGenerationLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "feature" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputRefs" JSONB,
  "outputId" TEXT,
  "tokensIn" INTEGER,
  "tokensOut" INTEGER,
  "cacheHit" BOOLEAN,
  "latencyMs" INTEGER,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AIGenerationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AIGenerationLog_userId_createdAt_idx"
  ON "AIGenerationLog"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AIGenerationLog_feature_createdAt_idx"
  ON "AIGenerationLog"("feature", "createdAt" DESC);
