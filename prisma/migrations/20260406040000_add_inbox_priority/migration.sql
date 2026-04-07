-- AlterTable: Add priority fields to InboxItem
ALTER TABLE "InboxItem" ADD COLUMN IF NOT EXISTS "priority" TEXT;
ALTER TABLE "InboxItem" ADD COLUMN IF NOT EXISTS "priorityScore" INTEGER;
