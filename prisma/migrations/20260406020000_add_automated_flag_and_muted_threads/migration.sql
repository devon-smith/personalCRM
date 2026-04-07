-- AlterTable: Add isAutomated to EmailMessage
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "isAutomated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Add mutedThreads to GmailSyncState
ALTER TABLE "GmailSyncState" ADD COLUMN IF NOT EXISTS "mutedThreads" TEXT[] DEFAULT ARRAY[]::TEXT[];
