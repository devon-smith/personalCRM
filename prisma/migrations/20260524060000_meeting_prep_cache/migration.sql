-- External research cache: OpenAlex / Crossref / future Semantic Scholar
-- responses get cached here with a per-row TTL so that meeting prep
-- panels don't hammer external APIs on every page load.
--
-- Keyed by (source, externalKey). For OpenAlex authors that's the OpenAlex
-- author id ("https://openalex.org/A123..."); for Crossref it's the DOI;
-- for OpenAlex author SEARCH it's the search query string.
CREATE TABLE IF NOT EXISTS "ExternalResearchCache" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "externalKey" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalResearchCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalResearchCache_source_kind_externalKey_key"
  ON "ExternalResearchCache"("source", "kind", "externalKey");
CREATE INDEX IF NOT EXISTS "ExternalResearchCache_expiresAt_idx"
  ON "ExternalResearchCache"("expiresAt");

-- Once a Contact is matched to a scholarly profile, persist the IDs so
-- subsequent prep loads skip the disambiguation step.
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "openAlexAuthorId" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "orcid" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "scholarlyProfileMatchedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Contact_openAlexAuthorId_idx"
  ON "Contact"("openAlexAuthorId");
