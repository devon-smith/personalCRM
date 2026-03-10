-- CreateTable
CREATE TABLE "RelationshipInsight" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "healthScore" INTEGER NOT NULL,
    "healthLabel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "actions" TEXT[],
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelationshipInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyDigest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipInsight_contactId_key" ON "RelationshipInsight"("contactId");

-- CreateIndex
CREATE INDEX "RelationshipInsight_userId_idx" ON "RelationshipInsight"("userId");

-- CreateIndex
CREATE INDEX "WeeklyDigest_userId_weekStart_idx" ON "WeeklyDigest"("userId", "weekStart");

-- AddForeignKey
ALTER TABLE "RelationshipInsight" ADD CONSTRAINT "RelationshipInsight_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipInsight" ADD CONSTRAINT "RelationshipInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyDigest" ADD CONSTRAINT "WeeklyDigest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
