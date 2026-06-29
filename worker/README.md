# worker/

Graphile Worker process — durable, retryable background jobs backed by
the same Postgres instance the Next.js app uses. Lives in the
`graphile_worker` schema, separate from Prisma's migrations.

## What runs here

| Task | Schedule | Purpose |
|---|---|---|
| `embedding-refresh` | every 5 min | Re-embed contacts whose `embeddingUpdatedAt` is stale |
| `watch-renew` | every 6 days at 03:17 UTC | Renew Gmail + Calendar Pub/Sub watches |
| `gmail-sync` | every 3 min | Incremental Gmail sync; this is the default freshness path |
| `calendar-sync` | every 30 min | Calendar sync for meetings and prep context |
| `circle-google-sync` | nightly at 04:11 UTC | Push CRM Circles to Google contact groups |
| `openalex-affiliation-diff` | nightly at 04:33 UTC | Detect affiliation changes for tracked researchers |
| `linkedin-notifications-scan` | nightly at 04:55 UTC | Extract job-change/promotion signals from LinkedIn emails |
| `signal-detection` | Mondays at 05:11 UTC | Search for recent public signals on inner-circle contacts |
| `morning-brief` | weekdays at 13:30 UTC | Assemble the morning brief draft |
| `voice-corpus-index` | Sundays at 09:42 UTC | Index recently sent mail into the voice corpus |
| `contact-attribute-extraction` | daily at 02:00 UTC | Refresh contact profiles from accumulated interactions |
| `graph-edge-extraction` | daily at 02:30 UTC | Recompute relationship graph edges |
| `memory-synthesis` | daily at 03:00 UTC | Refresh contact memory summaries |
| `mention-extraction` | daily at 03:30 UTC | Extract mentioned-contact edges from outbound email |
| `inbox-draft-prepopulate` | daily at 04:00 UTC | Prepopulate drafts for open inbox items |
| `observations-generation` | daily at 06:00 UTC | Generate dashboard observations from recent signals |
| `extract-life-events` | every 4 hours | Extract life events from inbound email backlog |
| `sync-run-retention` | daily at 01:45 UTC | Retain sync telemetry and mark abandoned running rows |
| `provider-call-retention` | daily at 01:55 UTC | Retain provider-call telemetry for usage windows |

Add more tasks in `worker/tasks/*.ts`. Default export is the task function.

## Running

```bash
# 1. Initialize the graphile_worker schema (one-time per database)
npm run worker:migrate

# 2. Start the worker process
npm run worker
```

`npm run worker:migrate` and the worker runtime both prefer
`WORKER_DATABASE_URL` when set, otherwise `DATABASE_URL`. In production
use the direct Postgres connection for `WORKER_DATABASE_URL`;
graphile-worker uses named prepared statements that do not work
reliably through transaction pooling. The Graphile runner, web-side
enqueue utility, and task-local Prisma clients all use the same worker
DB helper so scheduled jobs do not accidentally fall back to the pooled
app URL. The worker entrypoint also marks `CRM_WORKER_RUNTIME=true`,
which lets shared app helpers that use the lazy `src/lib/prisma`
singleton prefer `WORKER_DATABASE_URL` without changing normal Vercel
web requests. Concurrency is 4, polls every 2s, and handles
SIGINT/SIGTERM cleanly.

## Where to run it

The worker is a long-running process — **not** a serverless function.
Options:

- **Railway / Fly.io / a small VPS**: just `npm run worker` in a
  separate service. Cheapest path.
- **Self-hosted (single instance)**: spawn the worker alongside the
  Next.js process via a process manager (pm2, systemd, Docker compose
  with two services).
- **Vercel**: not supported — Vercel functions are stateless. Run the
  worker on Railway and the web app on Vercel, both pointing at the
  same Supabase database.

The web app should not duplicate these schedules with Vercel Cron. If
the worker is healthy, browser fallback sync should remain disabled and
Vercel should only handle request/response API work plus webhook job
enqueues.

## Enqueueing jobs from the Next.js side

```ts
import { enqueue } from "@/../worker/queue-client";

await enqueue("embedding-refresh", { contactId: c.id });
```

The cron entries in `worker/index.ts` cover the periodic case;
`enqueue` is for ad-hoc triggers from webhooks or API routes.

## Browser sync fallback

The worker now owns Gmail and Calendar freshness through
`gmail-sync`, `calendar-sync`, push webhook enqueues, and cron
fallbacks. The browser-side `useAutoSync` hook is opt-in in every
environment with `NEXT_PUBLIC_ENABLE_BROWSER_SYNC=true`, so open tabs do
not create extra provider polling by default.

Google Contacts import is still user-triggered from the Sources UI.
