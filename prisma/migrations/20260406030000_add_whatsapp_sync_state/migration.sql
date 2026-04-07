-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppSyncState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMP(3),
    "messagesSynced" INTEGER NOT NULL DEFAULT 0,
    "contactsMatched" INTEGER NOT NULL DEFAULT 0,
    "unmatchedChats" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppSyncState_userId_key" ON "WhatsAppSyncState"("userId");

-- AddForeignKey
ALTER TABLE "WhatsAppSyncState" ADD CONSTRAINT "WhatsAppSyncState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
