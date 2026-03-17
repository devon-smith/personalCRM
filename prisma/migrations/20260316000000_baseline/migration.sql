-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ContactTier" AS ENUM ('INNER_CIRCLE', 'PROFESSIONAL', 'ACQUAINTANCE');

-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('MANUAL', 'CSV_IMPORT', 'GOOGLE_CONTACTS', 'GMAIL_DISCOVER', 'APPLE_CONTACTS', 'IMESSAGE', 'LINKEDIN', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "SightingResolution" AS ENUM ('PENDING', 'AUTO_MERGED', 'REVIEW_NEEDED', 'MANUALLY_MERGED', 'MANUALLY_REJECTED', 'NEW_CONTACT');

-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('EMAIL', 'MESSAGE', 'MEETING', 'CALL', 'NOTE');

-- CreateEnum
CREATE TYPE "InteractionDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "ActionItemStatus" AS ENUM ('OPEN', 'DONE', 'DISMISSED');

-- CreateEnum
CREATE TYPE "JournalMood" AS ENUM ('POSITIVE', 'NEUTRAL', 'CONCERN');

-- CreateEnum
CREATE TYPE "ChangelogType" AS ENUM ('JOB_CHANGE', 'ROLE_CHANGE', 'COMPANY_CHANGE');

-- CreateEnum
CREATE TYPE "ChangelogStatus" AS ENUM ('PENDING', 'SEEN', 'ACTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('DRAFT', 'SENT', 'DISCARDED');

-- CreateEnum
CREATE TYPE "DraftType" AS ENUM ('REPLY_EMAIL', 'CATCHING_UP', 'CONGRATULATE', 'ASK', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "InboxItemStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED', 'SNOOZED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "additionalEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phone" TEXT,
    "additionalPhones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "company" TEXT,
    "role" TEXT,
    "tier" "ContactTier" NOT NULL DEFAULT 'PROFESSIONAL',
    "tags" TEXT[],
    "nicknames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedinUrl" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "notes" TEXT,
    "followUpDays" INTEGER,
    "lastInteraction" TIMESTAMP(3),
    "avatarUrl" TEXT,
    "birthday" DATE,
    "howWeMet" TEXT,
    "source" "ContactSource" NOT NULL DEFAULT 'MANUAL',
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "InteractionType" NOT NULL,
    "direction" "InteractionDirection" NOT NULL,
    "channel" TEXT,
    "subject" TEXT,
    "summary" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sourceId" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chatId" TEXT,
    "isGroupChat" BOOLEAN NOT NULL DEFAULT false,
    "chatName" TEXT,
    "needsReply" BOOLEAN,
    "needsReplyReason" TEXT,
    "needsReplyConfidence" DOUBLE PRECISION,
    "classifiedAt" TIMESTAMP(3),

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxDismissal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snoozeUntil" TIMESTAMP(3),

    CONSTRAINT "InboxDismissal_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "Circle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6B7280',
    "icon" TEXT NOT NULL DEFAULT 'users',
    "followUpDays" INTEGER NOT NULL DEFAULT 30,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Circle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactCircle" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactCircle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT,
    "status" "ActionItemStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "context" TEXT,
    "sourceId" TEXT,
    "threadId" TEXT,
    "channel" TEXT,
    "classification" TEXT,
    "dueDate" TIMESTAMP(3),
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactSighting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "ContactSource" NOT NULL,
    "externalId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "role" TEXT,
    "avatarUrl" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "linkedinUrl" TEXT,
    "rawData" JSONB,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contactId" TEXT,
    "resolution" "SightingResolution" NOT NULL DEFAULT 'PENDING',
    "confidence" DOUBLE PRECISION,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ContactSighting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mood" "JournalMood" NOT NULL DEFAULT 'NEUTRAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactChangelog" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ChangelogType" NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "source" TEXT NOT NULL DEFAULT 'linkedin_reimport',
    "status" "ChangelogStatus" NOT NULL DEFAULT 'PENDING',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actedAt" TIMESTAMP(3),

    CONSTRAINT "ContactChangelog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gmailId" TEXT NOT NULL,
    "threadId" TEXT,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT,
    "snippet" TEXT,
    "direction" "InteractionDirection" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "contactId" TEXT,
    "contactName" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
    "type" "DraftType" NOT NULL,
    "tone" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "subjectLine" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailSyncState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "historyId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "contactsImported" BOOLEAN NOT NULL DEFAULT false,
    "additionalUserEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unmatchedSenders" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnoozedContact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnoozedContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IMessageSyncState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "handleId" TEXT NOT NULL,
    "contactId" TEXT,
    "service" TEXT NOT NULL,
    "lastMessageGuid" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IMessageSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotionSyncState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notionToken" TEXT NOT NULL,
    "notionPageId" TEXT NOT NULL,
    "userHandles" TEXT,
    "lastBlockId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotionSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtensionToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Extension',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ExtensionToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "threadKey" TEXT NOT NULL DEFAULT '',
    "status" "InboxItemStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "snoozeUntil" TIMESTAMP(3),
    "contactName" TEXT NOT NULL,
    "company" TEXT,
    "tier" TEXT NOT NULL,
    "isGroupChat" BOOLEAN NOT NULL DEFAULT false,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "contactLinkedinUrl" TEXT,
    "triggerInteractionId" TEXT NOT NULL,
    "triggerAt" TIMESTAMP(3) NOT NULL,
    "messagePreview" JSONB,
    "messageCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Contact_userId_idx" ON "Contact"("userId");

-- CreateIndex
CREATE INDEX "Contact_email_idx" ON "Contact"("email");

-- CreateIndex
CREATE INDEX "Contact_userId_lastInteraction_idx" ON "Contact"("userId", "lastInteraction");

-- CreateIndex
CREATE INDEX "Interaction_contactId_idx" ON "Interaction"("contactId");

-- CreateIndex
CREATE INDEX "Interaction_occurredAt_idx" ON "Interaction"("occurredAt");

-- CreateIndex
CREATE INDEX "Interaction_userId_occurredAt_idx" ON "Interaction"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "Interaction_userId_contactId_occurredAt_idx" ON "Interaction"("userId", "contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "Interaction_userId_chatId_occurredAt_idx" ON "Interaction"("userId", "chatId", "occurredAt");

-- CreateIndex
CREATE INDEX "InboxDismissal_userId_idx" ON "InboxDismissal"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InboxDismissal_userId_chatId_channel_key" ON "InboxDismissal"("userId", "chatId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipInsight_contactId_key" ON "RelationshipInsight"("contactId");

-- CreateIndex
CREATE INDEX "RelationshipInsight_userId_idx" ON "RelationshipInsight"("userId");

-- CreateIndex
CREATE INDEX "WeeklyDigest_userId_weekStart_idx" ON "WeeklyDigest"("userId", "weekStart");

-- CreateIndex
CREATE INDEX "Circle_userId_idx" ON "Circle"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Circle_userId_name_key" ON "Circle"("userId", "name");

-- CreateIndex
CREATE INDEX "ContactCircle_circleId_idx" ON "ContactCircle"("circleId");

-- CreateIndex
CREATE INDEX "ContactCircle_contactId_idx" ON "ContactCircle"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactCircle_contactId_circleId_key" ON "ContactCircle"("contactId", "circleId");

-- CreateIndex
CREATE INDEX "ActionItem_userId_status_idx" ON "ActionItem"("userId", "status");

-- CreateIndex
CREATE INDEX "ActionItem_contactId_idx" ON "ActionItem"("contactId");

-- CreateIndex
CREATE INDEX "ContactSighting_userId_resolution_idx" ON "ContactSighting"("userId", "resolution");

-- CreateIndex
CREATE INDEX "ContactSighting_email_idx" ON "ContactSighting"("email");

-- CreateIndex
CREATE INDEX "ContactSighting_phone_idx" ON "ContactSighting"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "ContactSighting_userId_source_externalId_key" ON "ContactSighting"("userId", "source", "externalId");

-- CreateIndex
CREATE INDEX "JournalEntry_contactId_idx" ON "JournalEntry"("contactId");

-- CreateIndex
CREATE INDEX "JournalEntry_userId_idx" ON "JournalEntry"("userId");

-- CreateIndex
CREATE INDEX "ContactChangelog_userId_status_idx" ON "ContactChangelog"("userId", "status");

-- CreateIndex
CREATE INDEX "ContactChangelog_contactId_idx" ON "ContactChangelog"("contactId");

-- CreateIndex
CREATE INDEX "EmailMessage_userId_occurredAt_idx" ON "EmailMessage"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "EmailMessage_contactId_idx" ON "EmailMessage"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_userId_gmailId_key" ON "EmailMessage"("userId", "gmailId");

-- CreateIndex
CREATE INDEX "Draft_userId_status_idx" ON "Draft"("userId", "status");

-- CreateIndex
CREATE INDEX "Draft_contactId_idx" ON "Draft"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "GmailSyncState_userId_key" ON "GmailSyncState"("userId");

-- CreateIndex
CREATE INDEX "SnoozedContact_userId_until_idx" ON "SnoozedContact"("userId", "until");

-- CreateIndex
CREATE UNIQUE INDEX "SnoozedContact_userId_contactId_key" ON "SnoozedContact"("userId", "contactId");

-- CreateIndex
CREATE INDEX "IMessageSyncState_userId_idx" ON "IMessageSyncState"("userId");

-- CreateIndex
CREATE INDEX "IMessageSyncState_userId_contactId_idx" ON "IMessageSyncState"("userId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "IMessageSyncState_userId_handleId_key" ON "IMessageSyncState"("userId", "handleId");

-- CreateIndex
CREATE UNIQUE INDEX "NotionSyncState_userId_key" ON "NotionSyncState"("userId");

-- CreateIndex
CREATE INDEX "NotionSyncState_userId_idx" ON "NotionSyncState"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtensionToken_tokenHash_key" ON "ExtensionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ExtensionToken_userId_idx" ON "ExtensionToken"("userId");

-- CreateIndex
CREATE INDEX "InboxItem_userId_status_idx" ON "InboxItem"("userId", "status");

-- CreateIndex
CREATE INDEX "InboxItem_userId_status_triggerAt_idx" ON "InboxItem"("userId", "status", "triggerAt");

-- CreateIndex
CREATE INDEX "InboxItem_contactId_idx" ON "InboxItem"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "InboxItem_userId_contactId_channel_threadKey_key" ON "InboxItem"("userId", "contactId", "channel", "threadKey");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxDismissal" ADD CONSTRAINT "InboxDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipInsight" ADD CONSTRAINT "RelationshipInsight_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipInsight" ADD CONSTRAINT "RelationshipInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyDigest" ADD CONSTRAINT "WeeklyDigest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Circle" ADD CONSTRAINT "Circle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactCircle" ADD CONSTRAINT "ContactCircle_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactCircle" ADD CONSTRAINT "ContactCircle_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactSighting" ADD CONSTRAINT "ContactSighting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactSighting" ADD CONSTRAINT "ContactSighting_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactChangelog" ADD CONSTRAINT "ContactChangelog_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailSyncState" ADD CONSTRAINT "GmailSyncState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IMessageSyncState" ADD CONSTRAINT "IMessageSyncState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotionSyncState" ADD CONSTRAINT "NotionSyncState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtensionToken" ADD CONSTRAINT "ExtensionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

