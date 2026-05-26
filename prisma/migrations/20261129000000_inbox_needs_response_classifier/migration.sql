-- M0.x.2: needs-response classifier on InboxItem.
--
-- Today every inbound from a known contact lands as an OPEN InboxItem,
-- but the majority don't actually need a reply (FYIs, thanks, social
-- pleasantries). A Haiku call classifies each item; the default
-- dashboard view filters needsResponse=false out.
--
-- Migrating away from the older per-Interaction needsReply path:
-- generate-observations.ts now queries InboxItem.needsResponse, and
-- /api/inbox-items/classify is deleted.

-- ─── New classification columns on InboxItem ──────────────────
ALTER TABLE "InboxItem"
  ADD COLUMN "needsResponse"      BOOLEAN,
  ADD COLUMN "responseConfidence" DOUBLE PRECISION,
  ADD COLUMN "responseReason"     TEXT,
  ADD COLUMN "responseCategory"   TEXT,
  ADD COLUMN "classifiedAt"       TIMESTAMP(3);

-- Composite index for the default inbox filter
-- (userId, status, needsResponse).
CREATE INDEX "InboxItem_userId_status_needsResponse_idx"
  ON "InboxItem"("userId", "status", "needsResponse");

-- ─── ClassifierFeedback (manual overrides) ────────────────────
CREATE TABLE "ClassifierFeedback" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "inboxItemId"   TEXT NOT NULL,
  "bodyExcerpt"   TEXT NOT NULL,
  "modelDecision" BOOLEAN NOT NULL,
  "userDecision"  BOOLEAN NOT NULL,
  "reason"        TEXT,
  "category"      TEXT,
  "confidence"    DOUBLE PRECISION,
  "overriddenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClassifierFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClassifierFeedback_userId_overriddenAt_idx"
  ON "ClassifierFeedback"("userId", "overriddenAt");
CREATE INDEX "ClassifierFeedback_inboxItemId_idx"
  ON "ClassifierFeedback"("inboxItemId");

ALTER TABLE "ClassifierFeedback"
  ADD CONSTRAINT "ClassifierFeedback_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClassifierFeedback"
  ADD CONSTRAINT "ClassifierFeedback_inboxItemId_fkey"
  FOREIGN KEY ("inboxItemId") REFERENCES "InboxItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Drop legacy Interaction.needsReply* columns ──────────────
-- The on-demand /api/inbox-items/classify route wrote to these and
-- generate-observations.ts read from them; both paths are migrated
-- to InboxItem.needsResponse in the same PR. Data loss is acceptable:
-- the new classifier re-runs on every OPEN item via the backfill
-- script (scripts/classify-inbox-backfill.ts).
ALTER TABLE "Interaction"
  DROP COLUMN IF EXISTS "needsReply",
  DROP COLUMN IF EXISTS "needsReplyReason",
  DROP COLUMN IF EXISTS "needsReplyConfidence",
  DROP COLUMN IF EXISTS "classifiedAt";
