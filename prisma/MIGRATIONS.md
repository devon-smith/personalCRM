# Prisma migrations — operator notes

## The rule

**If you apply DDL to the database, you write a migration file.**

The two paths to apply DDL are:

1. **Prisma's normal flow** — edit `schema.prisma`, run
   `prisma migrate dev --name <description>`. Prisma generates the
   migration SQL, applies it, and commits the file. No drift.

2. **Direct SQL (Supabase Studio, MCP tool, psql)** — you must follow
   it up by creating a matching migration file. See the procedure
   below.

`prisma migrate deploy` (the production path) just plays applied
rows from `_prisma_migrations` and trusts what's there. So skipping
the file works fine in prod — until a fresh clone running
`prisma migrate dev` (or a `migrate reset`) tries to reconstruct the
database from local files and discovers it can't.

## When to use which command

| Command | When | What it does |
| --- | --- | --- |
| `prisma migrate dev` | Local development | Generates a migration from schema diff, applies it, regenerates client |
| `prisma migrate deploy` | Production / CI | Applies pending migration files. Never generates. Never resets. |
| `prisma migrate resolve --applied <name>` | Recover from drift | Marks an existing migration row as applied without re-running its SQL |
| `prisma migrate status` | Health check | Reports drift between `_prisma_migrations` and local files |
| `prisma db pull --schema=tmp.prisma` | Audit only | Dumps the live DB into a separate schema file for diffing |
| `prisma db push` | **Never** in this project | Skips the migration history entirely. Always drift. |

## Procedure: backfilling a missing migration

You applied DDL outside Prisma's flow and now `_prisma_migrations`
has a row with no matching file. To fix:

```bash
# 1. Capture what's in the DB to a side file
DATABASE_URL="$WORKER_DATABASE_URL" npx prisma db pull --schema=prisma/_audit.prisma

# 2. Diff against the canonical schema to find the drift
diff prisma/schema.prisma prisma/_audit.prisma | less

# 3. For each missing migration:
mkdir prisma/migrations/<YYYYMMDDHHMMSS>_<descriptive-name>
# Write migration.sql with the actual DDL. Use the same shape Prisma
# uses (CREATE TABLE "X" (...), CREATE INDEX ..., ALTER TABLE ... ADD
# CONSTRAINT ... FOREIGN KEY ...). Wrap in CASCADE / UPDATE rules
# as the live schema has them.

# 4. Mark the migration as already applied (no-ops if the row
# already exists in _prisma_migrations).
npx prisma migrate resolve --applied <YYYYMMDDHHMMSS>_<descriptive-name>

# 5. Add the tables / columns to schema.prisma. Generate.
npx prisma format
npx prisma generate

# 6. Verify everything's clean:
npx prisma migrate status   # → "Database schema is up to date!"

# 7. Throw away the audit file.
rm prisma/_audit.prisma
```

## History: the 2026-05 backfill (M0.3)

Seven migrations were marked applied in `_prisma_migrations` without
ever having matching files in `prisma/migrations/`:

- `20260412000000_add_import_log`
- `20260412010000_add_api_usage_log`
- `20260412020000_add_merge_log_soft_delete`
- `20260412213251_add_daily_priority_queue`
- `20260412220215_add_inbox_priority_item`
- `20260412222236_add_meeting_prep_caches`
- `20260412224704_add_meeting_person_summary_cache`

Files were reconstructed from the live DB on 2026-05-26 by the
procedure above. The tables they create (`ApiUsageLog`,
`DailyPriorityQueue`, `ImportLog`, `InboxPriorityItem`,
`MeetingPersonSummaryCache`, `MeetingPrepCache`,
`MeetingPrepWebCache`, `MergeLog`) and the `Contact.deletedAt`
column are no longer referenced by application code, but the rows
in prod were preserved — `ApiUsageLog` alone has ~4k rows of
historical token spend, `MergeLog` has ~100 rows of merge audit.

Also fixed in the same pass: a duplicate row in `_prisma_migrations`
for `20261125000000_voice_corpus` (one failed start at 18:55, one
success at 20:42 — the failed row was deleted).

If you want to drop one of the orphan models, do it as a NEW
migration that DROPs the table AND remove the model + back-relations
from `schema.prisma` in the same change.

## Common drift symptoms

- `prisma migrate status` reports "drift detected" → use the
  procedure above.
- `prisma migrate dev` warns "database schema is not in sync"
  and offers to reset → almost always means the DB has tables or
  columns the local migrations don't account for. Don't reset
  without `prisma db pull` first to capture the drift.
- App throws `column "X" does not exist` after `prisma migrate
  deploy` → either a migration was skipped (check status) or
  `Prisma` is reading from a stale generated client (run
  `prisma generate`).
