-- M7.2: Emergent relationships between contacts.
-- Edges are undirected at the type level — caller enforces stable
-- (from, to) ordering at insert time (fromContactId < toContactId)
-- so we don't double-count A→B and B→A.

CREATE TABLE "ContactEdge" (
  "id"               TEXT PRIMARY KEY,
  "userId"           TEXT NOT NULL,
  "fromContactId"    TEXT NOT NULL,
  "toContactId"      TEXT NOT NULL,
  "edgeType"         TEXT NOT NULL,
  "strength"         DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "observationCount" INTEGER NOT NULL DEFAULT 1,
  "evidence"         JSONB NOT NULL DEFAULT '{}'::JSONB,
  "firstObservedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastReinforcedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContactEdge_fromContactId_fkey"
    FOREIGN KEY ("fromContactId") REFERENCES "Contact"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContactEdge_toContactId_fkey"
    FOREIGN KEY ("toContactId") REFERENCES "Contact"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ContactEdge_fromContactId_toContactId_edgeType_key"
  ON "ContactEdge"("fromContactId", "toContactId", "edgeType");
CREATE INDEX "ContactEdge_userId_edgeType_idx" ON "ContactEdge"("userId", "edgeType");
CREATE INDEX "ContactEdge_fromContactId_idx"   ON "ContactEdge"("fromContactId");
CREATE INDEX "ContactEdge_toContactId_idx"     ON "ContactEdge"("toContactId");
