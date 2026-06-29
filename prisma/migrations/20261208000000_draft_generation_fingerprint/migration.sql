-- Avoid duplicate AI draft generations from repeated identical manual
-- requests. Nullable so existing drafts are untouched; indexed for
-- short-window reuse lookups per user.
ALTER TABLE "Draft" ADD COLUMN "generationFingerprint" TEXT;

CREATE INDEX "Draft_userId_generationFingerprint_createdAt_idx"
  ON "Draft"("userId", "generationFingerprint", "createdAt" DESC);
