# API Efficiency And Polish Notes

## Current Cost Surfaces

- Gmail sync: worker cron every 3 minutes, push-webhook enqueue path, manual sync buttons, and browser fallback sync.
- Calendar sync: worker cron every 30 minutes, push-webhook enqueue path, manual sync buttons, and browser full-sync fallback.
- Google Contacts: browser full-sync fallback and manual import.
- AI generation: reply drafts, meeting prep, memory synthesis, observations, mention extraction, location enrichment, and circle intelligence.
- Embeddings: contact search, voice example indexing, voice reference retrieval, and periodic embedding refresh.
- Health/status UI: dashboard rail, reconnect banner, source health, data health, and legacy health alerts.

## Changes Made In This Pass

- Browser Gmail sync is now a stale fallback instead of a fixed 2-minute poll. It checks the local sync state first and skips the Gmail API when the worker/browser synced recently.
- Browser contacts/calendar auto-sync now has a 6-hour local cooldown. Manual sync buttons still force a sync.
- `/api/health` is DB-only by default. It no longer spends a Gmail profile API call on normal dashboard loads. Use `/api/health?live=1` only when debugging token reachability.
- Gmail and Calendar webhook-triggered worker jobs now use stable per-user Graphile job keys, so rapid push-notification bursts collapse into one pending sync per source/user instead of stacking duplicate jobs.
- Dashboard home now uses `/api/dashboard/bootstrap` for stats, meetings, and birthdays instead of three client requests, and the page-level Gmail sync timer was removed in favor of the shared shell sync fallback.
- Reply queue now uses `/api/reply-queue/bootstrap` for inbox items, draft list, and the small Gmail reconnect/sync fields it needs. It no longer polls the full data-health payload every minute, and the legacy `/api/inbox-items` short cache is scoped per user.
- Persistent dashboard chrome now uses `/api/source-status/google` for the reconnect banner and Settings dot. Normal page navigation no longer loads the full data-health report unless the user opens a source/settings surface.
- Contacts and Google source status no longer poll every minute. They use longer stale windows and rely on focused invalidations from mutations/sync events.
- DB-only status/read endpoints now return private short-lived cache headers: birthdays, usage, Google source status, data-health, and default health. Live provider health checks stay uncached.
- Production now defaults to worker-mode sync. The browser fallback only runs in production when `NEXT_PUBLIC_ENABLE_BROWSER_SYNC=true`, or in local dev unless force-disabled.
- Manual draft generation now stores a short-window request fingerprint and reuses recent identical drafts instead of calling Anthropic again on repeat clicks, refresh loops, or duplicate composer submissions.
- Sources now surfaces sync runtime health from the existing data-health payload: worker status, browser fallback mode, and Gmail/Calendar freshness.
- API usage now rolls up existing `AIGenerationLog` rows by provider and by day, so Settings can show Anthropic/Voyage/OpenAI spend trends without making any provider calls.
- Gmail/Calendar syncs now write durable `SyncRun` telemetry across cron, webhook, manual, and browser-fallback triggers, including per-run Google provider-call counts. Webhook worker jobs honor their `userId` payload, so a single mailbox notification no longer scans every connected user.
- Sync-run telemetry now has a daily retention worker and structured error categories for auth, rate-limit, provider, network, and unknown failures.
- API usage now includes sync health aggregates from `SyncRun`: run counts, Google calls, success/error totals, source/trigger breakdowns, and error categories.
- Settings usage now computes explicit sync budget alerts from existing telemetry: total Google calls per day, browser-fallback call volume, elevated sync error rate, and long-running sync runs.
- Non-generation provider calls now write to `ProviderCallLog`: Voyage embedding batches for search/draft voice retrieval/voice corpus/contact embedding refresh, plus Gmail draft list/save/send user actions. Settings usage aggregates those rows separately from LLM generations and sync runs.
- `ProviderCallLog` now also covers Google OAuth refresh attempts, Calendar utility calls, birthday/scheduling Calendar scans, Calendar watch setup/stop, Google Contacts incremental/full People API import pages, and Circle-to-Google contact-group sync calls.
- Sync budget alert thresholds are now deployment-configurable through `SYNC_BUDGET_PROVIDER_CALLS_PER_DAY`, `SYNC_BUDGET_BROWSER_FALLBACK_CALLS_PER_DAY`, and `SYNC_BUDGET_ERROR_RATE_PERCENT`.
- Calendar empty states now use DB-only sync status returned with `/api/calendar`, so the Calendar and home meeting surfaces distinguish disconnected/missing-scope, never-synced, failed-sync, and genuinely-empty states without extra Google calls.
- Legacy/development surfaces are now hidden from the main UI unless enabled by public deployment flags: `NEXT_PUBLIC_ENABLE_IMESSAGE`, `NEXT_PUBLIC_ENABLE_WHATSAPP`, `NEXT_PUBLIC_ENABLE_ACTIVITY`, and `NEXT_PUBLIC_ENABLE_FEED`. Their direct API routes also fail closed with disabled/404 responses, including Feed, Activity, extension Feed/Activity writes, iMessage, and WhatsApp.

## Next Highest-Impact Efficiency Work

- Use production telemetry to tune sync budgets for the one-user deployment and promote per-user budgets only if this becomes multi-user.
- Add provider-call retention or aggregation once production `ProviderCallLog` volume is known, so detailed call rows stay useful without growing indefinitely.

## Product Polish Before App Finalization

- Add draft audit copy in the reply modal: exact inbound message used, thread messages loaded, voice references used, and known missing context.
- Add a user-facing "Refresh now" control for Gmail/Calendar that explains it may take a moment, rather than relying on background polling.
- Decide after launch whether disabled legacy routes should stay flag-gated for admin/debug use or be removed permanently.
