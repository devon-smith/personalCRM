This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Local Setup

Fresh-clone walkthrough. Everything below has bitten one verification
round or another; the lessons are encoded in `.env.example` and in
comments at the top of `worker/index.ts` and `src/lib/prisma.ts`.

1. **Install + Prisma client**

   ```bash
   npm install
   npx prisma generate
   ```

   `prisma generate` is required even on a fresh clone because the
   generated client lives under `src/generated/` and that path is
   `.gitignore`'d.

2. **Fill in `.env` + `.env.local`**

   Copy `.env.example` and populate. The split between the two files
   follows Next.js convention:
   - `.env`        — shared, committable defaults (none in this repo)
   - `.env.local`  — per-machine secrets (DATABASE_URL, API keys)

   The worker uses a custom dotenv loader (`worker/index.ts:17`) that
   loads `.env.local` first, then `.env`. The Next.js side handles
   this automatically.

   The two database URLs are NOT interchangeable. The web app reads
   `DATABASE_URL` (transaction-pooled, port 6543, `?pgbouncer=true`).
   The worker reads `WORKER_DATABASE_URL` (direct connection,
   port 5432) — graphile-worker uses named prepared statements which
   pgBouncer transaction-mode drops between calls. See `.env.example`
   for the explanation.

3. **Apply migrations**

   ```bash
   npx prisma migrate deploy
   ```

   `migrate deploy` (not `migrate dev`) is the safe path against a
   shared database. See `prisma/MIGRATIONS.md` for how to handle
   schema drift if you've applied DDL via Supabase MCP outside of
   Prisma.

4. **Run dev + worker**

   Two processes in parallel:

   ```bash
   npm run dev       # Next.js on http://localhost:3003
   npm run worker    # graphile-worker
   ```

5. **First-run housekeeping (optional)**

   ```bash
   npx tsx scripts/mark-noise-contacts.ts --dry-run
   npx tsx scripts/release-stale-locks.ts --dry-run
   ```

   Both are idempotent; drop `--dry-run` to apply.

## macOS dev gotcha — Turbopack cache write race

Next.js 16.1 (+ Turbopack) sometimes loses a write race during cold-start
on macOS, producing symptoms like:

- `Persisting failed: Another write batch or compaction is already active`
  in the dev log
- `routes-manifest.json` missing from `.next/dev/`
- Pages returning 500 once you sign in (middleware still works, render
  pipeline doesn't)

The root cause is Spotlight indexing `.next/cache/` concurrently with
Turbopack's atomic-write-then-rename pattern. The fix is one-time:

1. **Exclude `.next/` from Spotlight**: System Settings → Spotlight → Privacy →
   add the project folder.
2. If you already hit the race in a session, a *warm restart* (Ctrl+C the
   dev server and `npm run dev` again — **do not** `rm -rf .next`) usually
   recovers; the partial cache from the failed run usually has enough state
   to settle on the second try.

If you're getting bitten repeatedly even with Spotlight excluded, pin Next
to the last known-stable point release (`npm i next@16.0.4 --save-exact`)
until the upstream race is fixed.

## Operational scripts

A few helper scripts live in `scripts/` for one-off maintenance.
None require staging — all are safe to run against the live DB
(or `--dry-run` to preview).

- **`npx tsx scripts/enqueue.ts <task-name> [<json-payload>]`** —
  enqueue any worker task by name. Useful for backfills.
- **`npx tsx scripts/release-stale-locks.ts [--dry-run]`** — release
  graphile-worker job locks held by dead workers. Targets rows
  locked >6h with no `last_error`. Run when the queue stops making
  progress and the worker logs show no activity — usually means a
  prior process died (OOM, container kill) without releasing its
  locks. Safe to schedule weekly.
- **`npx tsx scripts/mark-noise-contacts.ts [--dry-run] [--verbose]`** —
  scans all contacts through the noise detector and toggles
  `Contact.isNoise`. Re-run after tightening the detector.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy

Use Vercel for the Next.js web app and a separate long-running service
for `npm run worker` (Railway, Fly.io, Render, or a small VPS). Vercel
functions are request-scoped; the Graphile Worker is the process that
owns Gmail sync, Calendar sync, draft prepopulation, memory synthesis,
and scheduled jobs.

Production builds default to worker-mode sync: the browser-side
`useAutoSync` fallback does not run unless
`NEXT_PUBLIC_ENABLE_BROWSER_SYNC=true` is set. Leave that unset once
the worker is deployed. This prevents one Gmail/Calendar poller per
open browser tab.

Minimum production env checklist:

- `NEXTAUTH_URL` set to the HTTPS app URL.
- `AUTH_SECRET` / `NEXTAUTH_SECRET` set to stable secrets.
- `AUTH_ALLOWED_EMAILS` limited to the intended user(s).
- `DATABASE_URL` set to the pooled Postgres connection for Vercel.
- `WORKER_DATABASE_URL` set to the direct Postgres connection for the
  worker host.
- `CAPACITOR_SERVER_URL` set to the same HTTPS app URL before building
  the iOS wrapper.
- Google OAuth redirect URLs updated to the production domain.
