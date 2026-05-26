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

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
