-- M0.x.6: Draft workspace state.
--
-- Adds JSON columns to Draft to support iterative refinement via the
-- workspace UI (/drafts/[id]/compose). Existing drafts get default
-- empty values; the legacy single-shot draft flow keeps working
-- against the same Draft table.

ALTER TABLE "Draft"
  ADD COLUMN "workspaceVersions" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "refinementChat"    JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "threadKey"         TEXT,
  ADD COLUMN "isWorkspaceDraft"  BOOLEAN NOT NULL DEFAULT FALSE;
