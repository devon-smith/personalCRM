# Deployment Readiness Checklist

This is the final punch list for calling the API-efficiency and polish pass done.

## Current Hotspot Status

- Draft variants: server-side in-flight and two-minute current-content reuse are implemented. Repeated variant taps no longer rebuild draft context or rerun Sonnet.
- Workspace draft creation: server-side in-flight dedupe is implemented per inbox item or draft fingerprint. Concurrent composer opens share one generation/write.
- Draft refinement: concurrent refinements for the same draft are rejected before voice context retrieval or Sonnet streaming starts, preventing overlapping version writes and duplicate model calls.
- Gmail action extraction: the public route requires changed thread refs from Gmail sync, dedupes/caps them at 50, scopes contact matching to sender emails observed in the fetched threads, and no longer permits direct broad recent-inbox scans. The maintenance backfill path remains library-only and caps AI classifications at 100.
- Meeting prep: the route reuses the shared seven-day Calendar window before widening to 30 days, returns private cache headers, caps public research to the highest-signal attendees, and relies on the external research cache for OpenAlex/Crossref/Brave/Anthropic misses.
- Worker AI tasks: scheduled tasks are batch-capped: inbox draft prepopulate 20, memory synthesis 30 contacts, contact profile extraction 50 contacts, mention extraction 50 emails, life-event extraction 25 emails, embedding refresh 100 contacts.

## Remaining API-Efficiency Checks

- Review production `ProviderCallLog`, `AIGenerationLog`, and `SyncRun` after the first real week and tune cron cadence or batch sizes from observed cost, not guesses.

## Vercel Deployment

- Run the read-only environment audit: `npm run deploy:audit`. Use `npm run deploy:audit -- --strict` before production promotion so high-risk findings fail the command.
- To audit a materialized Vercel env file, run `vercel env pull /tmp/personal-crm-vercel-production.env --environment=production`, then `npx tsx scripts/audit-deployment-env.ts --env-file=/tmp/personal-crm-vercel-production.env --production --strict`.
- Deploy the Next.js web/API app to Vercel.
- Use managed Postgres. Set `DATABASE_URL` to the pooled/serverless-safe URL.
- Run migrations against production with `npx prisma migrate deploy`.
- Generate Prisma during build through the existing `npm run build` script.
- Set the production app URL in auth/webhook env vars before connecting Google OAuth callbacks.

## Worker Deployment

- Run Graphile Worker as a separate always-on process on Render, Fly.io, Railway, or similar.
- Set `WORKER_DATABASE_URL` to the direct Postgres connection, not the pooled PgBouncer URL.
- Run `npm run worker:migrate` once against production.
- Start the worker with `npm run worker`.
- Confirm worker logs show all scheduled tasks registered and no prepared-statement errors.

## Required Environment Variables

- Verify this set with `npm run deploy:audit`; the command reports only presence and shape and does not print secret values.
- Auth: `AUTH_SECRET`, `NEXTAUTH_URL` or equivalent app URL, `AUTH_TRUST_HOST` if needed by the host.
- Database: `DATABASE_URL`, `WORKER_DATABASE_URL`.
- Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- Google webhooks: `WEBHOOK_BASE_URL`, `WEBHOOK_TOKEN`, `GMAIL_PUBSUB_TOPIC`.
- AI/search: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `BRAVE_API_KEY` if meeting/web research should run.
- Sync/runtime controls: leave `NEXT_PUBLIC_ENABLE_BROWSER_SYNC` unset unless intentionally using browser fallback.
- Budget controls: set `SYNC_BUDGET_PROVIDER_CALLS_PER_DAY`, `SYNC_BUDGET_BROWSER_FALLBACK_CALLS_PER_DAY`, and `SYNC_BUDGET_ERROR_RATE_PERCENT` after first-week telemetry if defaults are too loose.

## Mobile/iPhone QA

- Run local mobile dev with `npm run dev:mobile` and test from the iPhone on the same network.
- Verify PWA install/home-screen behavior or Capacitor build flow, depending on the chosen app packaging route.
- Check safe areas, bottom nav, keyboard behavior, fixed action bars, and scroll restoration on Home, Ask, Reply Queue, Calendar, meeting prep, Voice, Sources, Merge, and Settings usage.
- Verify rapid taps do not double submit Ask, voice transcription, smart parse, quick draft generation, workspace draft creation, variants, save-to-Gmail, send-Gmail, source refresh, push setup, birthday sync, or location enrichment.
- Test tab transitions and page loading states on iPhone Safari, not only desktop responsive mode.

## Jennifer Data Cleanup

- Run the read-only audit first: `npm run data:audit:jennifer`. Use `-- --strict` in CI/deploy checks if high-risk findings should fail the command.
- Start from a production DB seeded only with Jennifer's Google account and intended test contacts, or run a deletion/audit pass before launch.
- Remove Devon/dev imported contacts, iMessage/SMS/WhatsApp historical rows, test inbox items, test drafts, and old sync state unless explicitly needed for audit.
- Verify `User.email`, connected `Account.providerAccountId`, `GmailSyncState.additionalUserEmails`, and Calendar sync state all belong to Jennifer.
- Run one manual Gmail sync and one Calendar sync, then inspect recent `EmailMessage`, `Interaction`, `InboxItem`, `Draft`, and meeting prep rows for ownership/source correctness.
- Confirm birthdays are real birthday Calendar events, not general Calendar events labeled as birthdays.

## Final Acceptance Pass

- Run the full gate:
  - `npx next typegen`
  - `npx tsc --noEmit`
  - `npm run lint`
  - `npm run test:run`
  - `npm run build`
- Smoke-test authenticated flows:
  - Home loads meetings, birthdays, observations, and source status.
  - Ask answers only on Ask pages and shortcuts seed the input correctly.
  - Reply Queue loads only maintained channels and can generate, save, send, and resolve one low-risk Gmail test.
  - Calendar loads Google events and meeting prep opens a useful dossier.
  - Voice upload/reference/profile flows work without extra bootstrap churn.
  - Sources shows Gmail/Calendar status and manual refresh behaves intentionally.
  - Merge duplicate review works without loading all contacts by default.
  - Settings usage displays AI/provider/sync telemetry.
- After deployment, confirm Vercel function logs, worker logs, and usage telemetry agree that there are no hidden polling loops or repeated provider bursts.
