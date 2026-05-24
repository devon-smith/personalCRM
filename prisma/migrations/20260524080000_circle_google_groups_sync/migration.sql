-- Circles ↔ Google contact groups sync (Milestone 3.2).
--
-- Circle gains a link to its Google contact group + sync-state columns.
-- Contact gains the People API resource name so we can map CRM contacts
-- to Google's identifiers when modifying group membership.

ALTER TABLE "Circle" ADD COLUMN IF NOT EXISTS "googleGroupResourceName" TEXT;
ALTER TABLE "Circle" ADD COLUMN IF NOT EXISTS "googleGroupAccountId" TEXT;
ALTER TABLE "Circle" ADD COLUMN IF NOT EXISTS "googleSyncEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Circle" ADD COLUMN IF NOT EXISTS "googleSyncedAt" TIMESTAMP(3);
ALTER TABLE "Circle" ADD COLUMN IF NOT EXISTS "googleSyncError" TEXT;

CREATE INDEX IF NOT EXISTS "Circle_googleGroupResourceName_idx"
  ON "Circle"("googleGroupResourceName");

-- Contact gains the People API resourceName, populated lazily during
-- the first contacts-sync after this migration runs. Used by group
-- membership modification (which requires "people/c123..." identifiers
-- rather than emails).
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "peopleApiResourceName" TEXT;

CREATE INDEX IF NOT EXISTS "Contact_peopleApiResourceName_idx"
  ON "Contact"("peopleApiResourceName");
