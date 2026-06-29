# worker/

Graphile Worker process — durable, retryable background jobs backed by
the same Postgres instance the Next.js app uses. Lives in the
`graphile_worker` schema, separate from Prisma's migrations.

## What runs here

| Task | Schedule | Purpose |
|---|---|---|
| `embedding-refresh` | every 5 min | Re-embed contacts whose `embeddingUpdatedAt` is stale |
| `watch-renew` | every 6 days at 03:17 UTC | Renew Gmail + Calendar Pub/Sub watches (stub until 1.2/1.3) |

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

## Enqueueing jobs from the Next.js side

```ts
import { enqueue } from "@/../worker/queue-client";

await enqueue("embedding-refresh", { contactId: c.id });
```

The cron entries in `worker/index.ts` cover the periodic case;
`enqueue` is for ad-hoc triggers from webhooks or API routes.

## Browser sync fallback

The worker now owns production Gmail and Calendar freshness through
`gmail-sync`, `calendar-sync`, push webhook enqueues, and cron
fallbacks. The browser-side `useAutoSync` hook remains useful in local
dev and can be explicitly re-enabled in production with
`NEXT_PUBLIC_ENABLE_BROWSER_SYNC=true`, but production defaults to
worker-mode so open tabs do not create extra provider polling.

Google Contacts import is still user-triggered from the Sources UI.
