-- CreateTable
CREATE TABLE "Thread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceThreadId" TEXT NOT NULL,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreadParticipant" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,

    CONSTRAINT "ThreadParticipant_pkey" PRIMARY KEY ("id")
);

-- Add threadId column to Interaction
ALTER TABLE "Interaction" ADD COLUMN "threadId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Thread_userId_source_sourceThreadId_key" ON "Thread"("userId", "source", "sourceThreadId");

-- CreateIndex
CREATE INDEX "Thread_userId_lastActivityAt_idx" ON "Thread"("userId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "Thread_userId_source_idx" ON "Thread"("userId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadParticipant_threadId_contactId_key" ON "ThreadParticipant"("threadId", "contactId");

-- CreateIndex
CREATE INDEX "ThreadParticipant_contactId_idx" ON "ThreadParticipant"("contactId");

-- CreateIndex
CREATE INDEX "Interaction_threadId_idx" ON "Interaction"("threadId");

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadParticipant" ADD CONSTRAINT "ThreadParticipant_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
