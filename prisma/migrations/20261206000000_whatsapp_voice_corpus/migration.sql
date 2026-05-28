-- M0.x.13 — WhatsApp voice corpus + life-event readiness.
-- Adds full-body storage on Interaction (so we can index Jennifer's
-- outbound WhatsApp messages and run life-event extraction on inbound
-- WhatsApp messages), and makes VoiceExample polymorphic across email
-- and message channels via an interactionId FK + channel tag.

-- ─── Interaction: fullBody + lifeEventProcessedAt ──────────────
ALTER TABLE "Interaction"
  ADD COLUMN "fullBody" TEXT,
  ADD COLUMN "lifeEventProcessedAt" TIMESTAMP(3);

CREATE INDEX "Interaction_userId_lifeEventProcessedAt_idx"
  ON "Interaction"("userId", "lifeEventProcessedAt");

-- ─── VoiceExample: polymorphic source ──────────────────────────
-- 1. Add new columns (channel defaults to 'email' so existing rows
--    stay correct; interactionId is nullable for the email pre-image).
ALTER TABLE "VoiceExample"
  ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'email',
  ADD COLUMN "interactionId" TEXT;

-- 2. Loosen the email-only columns so WhatsApp rows can omit them.
ALTER TABLE "VoiceExample"
  ALTER COLUMN "emailMessageId" DROP NOT NULL,
  ALTER COLUMN "gmailId" DROP NOT NULL;

-- 3. Unique + FK + index for the new interaction path.
CREATE UNIQUE INDEX "VoiceExample_interactionId_key"
  ON "VoiceExample"("interactionId");

ALTER TABLE "VoiceExample"
  ADD CONSTRAINT "VoiceExample_interactionId_fkey"
  FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "VoiceExample_userId_channel_idx"
  ON "VoiceExample"("userId", "channel");
