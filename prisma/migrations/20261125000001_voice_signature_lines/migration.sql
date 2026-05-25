-- M6.1.1: Per-user signature lines detected via statistical frequency
-- analysis. Stripped from email bodies before voice feature extraction
-- so signature blocks don't dominate the n-gram fingerprint.

ALTER TABLE "VoiceProfile"
  ADD COLUMN "signatureLines" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
