-- M8.1: Per-contact conversational memory.
-- One row per Contact, synthesized incrementally by the memory-
-- synthesis worker (Claude Sonnet structured output).

CREATE TABLE "ContactMemory" (
  "id"                      TEXT PRIMARY KEY,
  "contactId"               TEXT UNIQUE NOT NULL,
  "discussedTopics"         JSONB NOT NULL DEFAULT '[]'::JSONB,
  "theyMentioned"           JSONB NOT NULL DEFAULT '[]'::JSONB,
  "openThreads"             JSONB NOT NULL DEFAULT '[]'::JSONB,
  "personalContext"         JSONB NOT NULL DEFAULT '{}'::JSONB,
  "recurringThemes"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "interactionsAtSynthesis" INTEGER NOT NULL DEFAULT 0,
  "synthesizedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContactMemory_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ContactMemory_contactId_idx" ON "ContactMemory"("contactId");
