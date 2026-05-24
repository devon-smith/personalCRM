-- Cache the most recently observed scholarly affiliation per contact
-- so the nightly OpenAlex diff job can detect changes vs. the previous
-- snapshot without re-reading the ExternalResearchCache.
ALTER TABLE "Contact"
  ADD COLUMN IF NOT EXISTS "lastSeenScholarlyInstitution" TEXT;
