-- DropTable
DROP TABLE IF EXISTS "NotionSyncState";

-- DropTable
DROP TABLE IF EXISTS "SnoozedContact";

-- CreateIndex (drift fix: already exists in DB, idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "Interaction_userId_sourceId_key" ON "Interaction"("userId", "sourceId");
