-- M0.4: Soft-quarantine for system-artifact contacts ("Settings",
-- "noreply@…", "LinkedIn", etc). Set to true by scripts/mark-noise-
-- contacts.ts using src/lib/intelligence/noise-detector.ts.
--
-- Downstream queries (search, neighbors, /people page) filter
-- isNoise=false by default; a "show system contacts" toggle can
-- still reveal them so false positives stay recoverable.

ALTER TABLE "Contact"
  ADD COLUMN "isNoise" BOOLEAN NOT NULL DEFAULT FALSE;

-- Composite index for the common search/list filter (userId + isNoise).
-- A partial index would be tighter for a "show noise" toggle, but Prisma
-- doesn't model partial indexes in schema.prisma, so we keep this
-- as a regular index to avoid migration drift.
CREATE INDEX "Contact_userId_isNoise_idx"
  ON "Contact"("userId", "isNoise");
