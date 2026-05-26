-- M0.x.3: /feed page + life event extraction.
--
-- Two-layer model: LifeEventSignal (raw extractions) feeds the
-- aggregator, which writes FeedItem rows (deduplicated, ready to
-- display). ContactChangelog is the other source.

-- ─── User: last visit timestamp for the rail-nav dot indicator ──
ALTER TABLE "User"
  ADD COLUMN "lastFeedVisitAt" TIMESTAMP(3);

-- ─── EmailMessage: track which rows we've already passed to the
-- life-event extractor (mirrors the mentionsProcessedAt pattern). ──
ALTER TABLE "EmailMessage"
  ADD COLUMN "lifeEventProcessedAt" TIMESTAMP(3);

CREATE INDEX "EmailMessage_userId_lifeEventProcessedAt_idx"
  ON "EmailMessage"("userId", "lifeEventProcessedAt");

-- ─── LifeEventSignal: raw extraction rows ─────────────────────
CREATE TABLE "LifeEventSignal" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "contactId"      TEXT NOT NULL,
  "signalType"     TEXT NOT NULL,
  "summary"        TEXT NOT NULL,
  "sourceType"     TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "detectedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LifeEventSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LifeEventSignal_userId_detectedAt_idx"
  ON "LifeEventSignal"("userId", "detectedAt");
CREATE INDEX "LifeEventSignal_contactId_idx"
  ON "LifeEventSignal"("contactId");

ALTER TABLE "LifeEventSignal"
  ADD CONSTRAINT "LifeEventSignal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LifeEventSignal"
  ADD CONSTRAINT "LifeEventSignal_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── FeedItem: aggregated display rows ────────────────────────
CREATE TABLE "FeedItem" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "contactId"      TEXT NOT NULL,
  "itemType"       TEXT NOT NULL,
  "headline"       TEXT NOT NULL,
  "body"           TEXT,
  "sourceType"     TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "linkUrl"        TEXT,
  "detectedAt"     TIMESTAMP(3) NOT NULL,
  "isHighlighted"  BOOLEAN NOT NULL DEFAULT FALSE,
  "isHidden"       BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FeedItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeedItem_userId_contactId_itemType_sourceRecordId_key"
  ON "FeedItem"("userId", "contactId", "itemType", "sourceRecordId");
CREATE INDEX "FeedItem_userId_isHidden_detectedAt_idx"
  ON "FeedItem"("userId", "isHidden", "detectedAt" DESC);
CREATE INDEX "FeedItem_contactId_detectedAt_idx"
  ON "FeedItem"("contactId", "detectedAt");

ALTER TABLE "FeedItem"
  ADD CONSTRAINT "FeedItem_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedItem"
  ADD CONSTRAINT "FeedItem_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
