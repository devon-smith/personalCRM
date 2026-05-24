-- Voice memo capture (Milestone 3.1): voice transcripts live on the
-- existing JournalEntry table so they flow into the meeting prep
-- dossier and contact detail UI without parallel-modeling.
-- source distinguishes "manual" notes from "voice"-transcribed ones.
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "voiceDurationSec" INTEGER;
