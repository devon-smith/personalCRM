-- M9.2: Unprompted observations the assistant surfaces on the
-- dashboard. Generated daily by the observations-generation worker.

CREATE TABLE "AssistantObservation" (
  "id"          TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "content"     TEXT NOT NULL,
  "contactId"   TEXT,
  "source"      TEXT NOT NULL,
  "sourceRefs"  JSONB NOT NULL DEFAULT '[]'::JSONB,
  "shownAt"     TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssistantObservation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AssistantObservation_userId_dismissedAt_createdAt_idx"
  ON "AssistantObservation"("userId", "dismissedAt", "createdAt" DESC);
