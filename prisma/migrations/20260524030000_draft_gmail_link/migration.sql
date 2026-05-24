-- Link CRM Draft rows to their real Gmail draft so "Save to Gmail" can
-- update the same draft on regeneration instead of creating duplicates.
ALTER TABLE "Draft" ADD COLUMN IF NOT EXISTS "gmailDraftId" TEXT;
ALTER TABLE "Draft" ADD COLUMN IF NOT EXISTS "gmailThreadId" TEXT;
ALTER TABLE "Draft" ADD COLUMN IF NOT EXISTS "inReplyToMessageId" TEXT;
ALTER TABLE "Draft" ADD COLUMN IF NOT EXISTS "recipientEmail" TEXT;
ALTER TABLE "Draft" ADD COLUMN IF NOT EXISTS "savedToGmailAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Draft_gmailDraftId_idx"
  ON "Draft"("gmailDraftId");
