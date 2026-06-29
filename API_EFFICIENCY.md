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

## Next Highest-Impact Efficiency Work

- Make worker mode the production default after deployment: set `NEXT_PUBLIC_DISABLE_BROWSER_SYNC=true` once the worker is reliably running.
- Persist AI generation fingerprints for expensive prompts. If the same reply draft context and voice refs are unchanged, reuse or offer regenerate instead of calling the model again automatically.
- Add budget/rate telemetry per provider from `AIGenerationLog`: daily Anthropic tokens, Voyage embedding calls, Gmail sync calls, and Google Calendar calls.
- Add sync-run visibility for cron/manual/webhook collisions: started at, completed at, source, duration, and provider calls made.

## Product Polish Before App Finalization

- Show sync freshness clearly in Sources: last Gmail sync, last Calendar sync, worker status, and whether browser fallback is active.
- Add draft audit copy in the reply modal: exact inbound message used, thread messages loaded, voice references used, and known missing context.
- Add meeting brief loading states that distinguish "calendar has no events" from "calendar has not synced."
- Add a user-facing "Refresh now" control for Gmail/Calendar that explains it may take a moment, rather than relying on background polling.
- Move legacy/development sources out of the main UI unless enabled by config: iMessage, WhatsApp, and feed/activity remnants.
