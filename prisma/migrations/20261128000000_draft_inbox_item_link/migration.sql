-- M0.9 task 5: link auto-prepopulated drafts back to their source
-- inbox item. The inbox-draft-prepopulate worker uses the unique
-- constraint to be idempotent — re-running can't produce duplicates
-- for items it already serviced.

ALTER TABLE "Draft"
  ADD COLUMN "inboxItemId" TEXT;

CREATE UNIQUE INDEX "Draft_inboxItemId_key"
  ON "Draft"("inboxItemId");

ALTER TABLE "Draft"
  ADD CONSTRAINT "Draft_inboxItemId_fkey"
  FOREIGN KEY ("inboxItemId") REFERENCES "InboxItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
