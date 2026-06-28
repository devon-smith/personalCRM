-- Source-backed person facts for Gmail-first relationship memory.
-- Each row keeps provenance so draft prompts and UI can cite exactly
-- which source produced a fact.

CREATE TABLE "PersonFact" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
  "sourceSystem" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "excerpt" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "confirmedByUser" BOOLEAN NOT NULL DEFAULT false,
  "dismissedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PersonFact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PersonFact_userId_contactId_type_value_sourceSystem_sourceRecordId_key"
  ON "PersonFact"("userId", "contactId", "type", "value", "sourceSystem", "sourceRecordId");

CREATE INDEX "PersonFact_userId_contactId_dismissedAt_idx"
  ON "PersonFact"("userId", "contactId", "dismissedAt");

CREATE INDEX "PersonFact_userId_type_idx"
  ON "PersonFact"("userId", "type");

ALTER TABLE "PersonFact"
  ADD CONSTRAINT "PersonFact_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PersonFact"
  ADD CONSTRAINT "PersonFact_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
