-- Add NEWS_MENTION variant to ChangelogType so the nightly signal-detection
-- task (Milestone 5.2) can write "X was mentioned in [headline]" surfaces
-- to ContactChangelog without inventing a new persistence model.
ALTER TYPE "ChangelogType" ADD VALUE IF NOT EXISTS 'NEWS_MENTION';
