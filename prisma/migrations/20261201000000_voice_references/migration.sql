-- M0.x.5: VoiceReference table.
--
-- Stores Jennifer's intentional voice — knowledge-base files exported
-- from her custom GPTs, manually-uploaded style guides, book excerpts,
-- etc. These reference materials DOMINATE the voice corpus during
-- draft generation because they represent how she WANTS to write,
-- not just how she has written historically.

CREATE TABLE "VoiceReference" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "filename"    TEXT NOT NULL,
  "sourceType"  TEXT NOT NULL DEFAULT 'gpt_knowledge_base',
  "content"     TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "weight"      DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "byteSize"    INTEGER NOT NULL DEFAULT 0,
  "guidance"    JSONB,
  "embedding"   vector(512),
  "addedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VoiceReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoiceReference_userId_contentHash_key"
  ON "VoiceReference"("userId", "contentHash");
CREATE INDEX "VoiceReference_userId_addedAt_idx"
  ON "VoiceReference"("userId", "addedAt" DESC);

ALTER TABLE "VoiceReference"
  ADD CONSTRAINT "VoiceReference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
