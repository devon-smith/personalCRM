-- M7.1: Structured per-contact attribute extraction.
-- One row per Contact, populated incrementally by the
-- contact-attribute-extraction worker task.

CREATE TABLE "ContactProfile" (
  "id"                       TEXT PRIMARY KEY,
  "contactId"                TEXT UNIQUE NOT NULL,
  "expertiseAreas"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "communicationStyle"       JSONB,
  "geographicContext"        JSONB,
  "personalitySignals"       JSONB,
  "relationshipStage"        TEXT,
  "rawAttributes"            JSONB NOT NULL DEFAULT '{}'::JSONB,
  "interactionsAtGeneration" INTEGER NOT NULL DEFAULT 0,
  "generatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContactProfile_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ContactProfile_contactId_idx" ON "ContactProfile"("contactId");
