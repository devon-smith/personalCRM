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

The worker connects via `DATABASE_URL` from `.env`. Concurrency is 4,
polls every 2s, and handles SIGINT/SIGTERM cleanly.

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

## Migration from useAutoSync

The browser-side `useAutoSync` hook still drives Gmail/Calendar/Contacts
sync today. Migration plan (per Milestone 4.1):

1. ✅ Worker process scaffolded with a real periodic task
   (`embedding-refresh`) and a stub for watch renewal.
2. ⏳ Move `gmail-sync` / `calendar-sync` / `contacts-sync` into
   `worker/tasks/` and trigger them on Pub/Sub webhook + cron fallback.
3. ⏳ Replace `useAutoSync` calls with queue enqueues from API routes.
4. ⏳ Add `/admin/jobs` page reading `graphile_worker.jobs` for visibility.
