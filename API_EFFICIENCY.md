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
- Detailed provider-call telemetry now has a daily retention worker. `PROVIDER_CALL_LOG_RETENTION_DAYS` defaults to 180 days, which preserves the 7/30/90-day Settings usage windows plus debugging headroom.
- Sources now frames manual Gmail/Calendar actions as "Refresh now", shows recent server-run status beside each service, and refreshes connected source indicators after manual runs.
- Calendar empty states now use DB-only sync status returned with `/api/calendar`, so the Calendar and home meeting surfaces distinguish disconnected/missing-scope, never-synced, failed-sync, and genuinely-empty states without extra Google calls.
- Legacy/development surfaces are now hidden from the main UI unless enabled by public deployment flags: `NEXT_PUBLIC_ENABLE_IMESSAGE`, `NEXT_PUBLIC_ENABLE_WHATSAPP`, and `NEXT_PUBLIC_ENABLE_FEED`. Their direct API routes fail closed with disabled/404 responses when unavailable; retired Activity read/write HTTP surfaces are hard-disabled.
- Reply queue draft review now lazily loads selected-draft provenance from the draft workspace context: exact inbound message source, loaded thread depth, matching voice references, and known missing context.
- Legacy Source health no longer polls its wide DB-only health report every minute. It now uses a five-minute client stale window, manual refresh, and a short private cache header.
- Dashboard home no longer renders the dev/admin `SyncAlerts` banner, so normal home visits avoid the extra `/api/health` request and duplicated Google reconnect messaging.
- The shared Ask box no longer fetches `/api/saved-queries` by default just to count history links. Dashboard and Ask already navigate/render history, so that count request is now opt-in.
- Calendar page no longer polls `/api/calendar` every five minutes while open. It now uses a five-minute stale window, manual Sync calendar, and a short private cache header for DB-backed event reads.
- Reply queue no longer polls `/api/reply-queue/bootstrap` every minute while open. It now shows the last loaded time, has a DB-only Refresh action, and keeps Gmail provider sync as an explicit "Sync Gmail" action.
- Dashboard inbox no longer polls `/api/inbox-items` every minute or uses pull-to-refresh as a hidden Gmail sync. It now has a DB-only Refresh path, explicit "Sync Gmail", short private cache headers, and optimistic row removal across cached inbox views.
- Dashboard home no longer polls `/api/dashboard/bootstrap` every five minutes. It now exposes a visible Refresh action, shows the last loaded time, and uses short private stale-while-revalidate cache headers for the combined DB-backed home payload.
- Removed the unused legacy `UnrespondedThreads` widget and `/api/interactions/unresponded` path, which were the last source of explicit React Query interval polling.
- Persistent Google/source-status surfaces no longer force refetches on every window focus event. Rail nav, reconnect banner, and legacy sync alerts now rely on normal stale windows, mount loads, and explicit invalidation after sync/reconnect actions.
- Dashboard assistant observations now ride on `/api/dashboard/bootstrap`, reusing the stale-observation cleanup helper and removing the extra `/api/observations` GET during normal home page loads.
- Removed the unused legacy `SyncAlerts` component so the old `/api/health` dashboard cleanup UI cannot be accidentally remounted. Source-status rail/banner consumers now share the server response type.
- Dashboard shell now owns the single Google source-status query and passes the result to the rail and reconnect banner, avoiding duplicate persistent query observers for the same shell status payload.
- Removed unused legacy dashboard widget components that each carried standalone fetches for action items, drafts, changelog, scheduling, Calendar, birthdays, and suggestions. The current home surface stays on `/api/dashboard/bootstrap`, while explicit pages keep their manual/intentional request paths.
- Inbox "Sync Gmail" no longer runs the legacy `/api/message-actions` AI classifier or invalidates its query. The unused action-items card was removed from the inbox bundle, leaving Gmail sync plus the current Gmail action extractor as the explicit manual path; manual sync now surfaces a real failure if either remaining POST fails.
- Removed the backend-only legacy `/api/message-actions` route and `src/lib/message-actions.ts` after verifying no app, worker, script, or test reference still used them. This closes an unused AI-classification endpoint and leaves Gmail action extraction as the single action-item scan path.
- Contact detail intelligence now loads profile, memory, and relationship graph neighbors through one DB-backed `/api/contacts/:id/intelligence` endpoint with a short private cache, replacing three parallel client requests and three separate auth/ownership checks on every contact story open.
- Removed the now-unused individual contact intelligence routes (`/profile`, `/memory`, `/network`) so the consolidated endpoint is the only internal contact-intelligence API surface.
- Voice settings now loads profile, corpus stats, and reference-material summaries through one DB-backed `/api/voice/bootstrap` request with a short private cache, replacing three page-load requests while leaving upload/delete/reindex mutations on their focused endpoints.
- The Voice reference library now reuses `/api/voice/bootstrap` for learned response tables plus reference rows, replacing its separate profile and reference-list reads with one initial request.
- People now loads filtered contacts, lightweight circle filter options, and duplicate-review count through one DB-backed `/api/people/bootstrap` request, replacing the page-load fan-out to `/api/contacts`, heavyweight `/api/circles`, and `/api/sightings`.
- Merge duplicates now loads duplicate groups and the LinkedIn pending count through one `/api/merge/bootstrap` request. Manual merge contact search and data-health gaps are intent-driven, so the default merge page no longer pulls the full contacts list or data-health report.
- Circle suggestions are now intent-driven and short-cacheable. The Circles page no longer scans uncircled contacts plus recent interaction groups on first load just to discover whether suggestions exist.
- Nickname duplicate matching is now intent-driven on the Merge page. The all-contact nickname scan no longer runs until the user opens the possible-duplicates section.
- Global contact pickers now use lazy, capped contact queries. The draft composer and quick-log picker no longer fetch contacts while closed, and when opened they request 20 rows instead of the default 500.
- Draft relationship-type inference now uses a longer client stale window plus a private response cache, reducing repeat classifier checks when reopening composer sessions for the same contact.
- Contact story secondary data now uses longer client stale windows for journal entries and bundled intelligence, avoiding repeat reads when reopening the same contact while preserving mutation invalidations.
- Contact edit and draft composer preset resolution now use a lightweight `/api/contacts/:id?scope=summary` payload instead of loading interactions, facts, profile, and memory that those flows do not render.
- LinkedIn circle assignment now uses `/api/circles?scope=summary` for selector options instead of loading every contact in every circle just to populate a dropdown.
- Manual merge contact pickers now run debounced, capped server-side contact searches instead of fetching the default contact list when the manual merge panel opens.
- Removed the unused generic sightings review component and converted `/api/sightings` into a fail-closed legacy stub. Current duplicate/contact-sighting review flows use the Merge and LinkedIn review surfaces instead.
- Converted unused legacy `/api/action-items` routes into fail-closed stubs so the old dashboard action-item API cannot duplicate Gmail action extraction or mutate stale action rows.
- Converted unused legacy `/api/suggestions` and `/api/scheduling` routes into fail-closed stubs, removing accidental Calendar/provider and broad contact-query work from retired dashboard widgets.
- Converted unused legacy `/api/dashboard/stats` and `/api/inbox` reads into fail-closed stubs. Active home and inbox surfaces use `/api/dashboard/bootstrap` and `/api/inbox-items`.
- Converted unused legacy `/api/changelog` routes into fail-closed stubs. Meeting prep and imports still use changelog data through focused server-side library calls.
- Converted unused legacy HTTP backfill routes into fail-closed stubs so direct requests cannot trigger large source imports or relationship coverage scans. Maintenance scripts remain available for intentional backfills.
- Converted unused legacy inbox debug/migration routes into fail-closed stubs so direct requests cannot run raw inbox diagnostics or all-interaction chat-id backfills.
- Converted unused legacy interaction cleanup/dedup routes into fail-closed stubs so direct requests cannot scan or delete historical interaction rows.
- Converted unused legacy `/api/threads/backfill` into a fail-closed stub. Current Gmail/iMessage sync paths create and link threads directly.
- Converted unused admin/debug and contact-maintenance HTTP routes into fail-closed stubs: admin job inspection, morning-brief preview/manual trigger, legacy duplicate scan, and CSV contact cleanup. Worker/source health and duplicate review now stay on the focused Sources, usage telemetry, and Merge bootstrap flows.
- Removed the final dashboard inbox Activity/History tab branch and made `/api/activity` fail closed unconditionally. The reply/inbox surfaces no longer carry a dormant activity query, tab state, or post-sync activity invalidation.
- Removed the retired `NEXT_PUBLIC_ENABLE_ACTIVITY` flag and made extension activity logging fail closed unconditionally. The LinkedIn extension docs no longer advertise profile-view activity logging.

## Next Highest-Impact Efficiency Work

- Use production telemetry to tune sync budgets for the one-user deployment and promote per-user budgets only if this becomes multi-user.
- Add provider-call aggregation if production `ProviderCallLog` volume is high enough that row-level retention alone is not sufficient.

## Product Polish Before App Finalization

- Decide after launch whether disabled legacy routes should stay flag-gated for admin/debug use or be removed permanently.
