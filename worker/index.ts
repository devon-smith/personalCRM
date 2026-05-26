/**
 * Graphile Worker entry point.
 *
 * Run as a separate Node process (`npm run worker`) — does not share the
 * Next.js server's request lifecycle. Manages its own Postgres
 * connection and lives in the graphile_worker schema, so it doesn't
 * touch Prisma's migration history.
 *
 * Tasks live in worker/tasks/*. Each file exports a default task
 * function — Graphile Worker auto-discovers them via the taskDirectory
 * option below.
 *
 * Cron-style scheduling is declared inline (crontab). For ad-hoc
 * triggers from the Next.js side, add a job programmatically via
 * `addJob` from worker/queue-client.ts.
 */
// ─── dotenv before everything ──────────────────────────────────────────
// Load .env.local first (Next.js convention, overrides .env), then .env.
// Default `import "dotenv/config"` only loads .env, which silently drops vars
// the user only set in .env.local — caused signal-detection to no-op when
// BRAVE_API_KEY lived only in .env.local.
//
// This MUST run before any module that captures env vars at import time —
// notably the `prisma` singleton in src/lib/prisma.ts. The Prisma client
// uses a lazy Proxy specifically to dodge this ordering trap (ESM hoists
// imports above this dotenv call), but other modules that read
// process.env at top level will see undefined unless dotenv ran first.
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });
dotenv.config({ path: ".env" });

import { run } from "graphile-worker";
import embeddingRefresh from "./tasks/embedding-refresh.js";
import watchRenew from "./tasks/watch-renew.js";
import circleGoogleSync from "./tasks/circle-google-sync.js";
import openAlexAffiliationDiff from "./tasks/openalex-affiliation-diff.js";
import gmailSync from "./tasks/gmail-sync.js";
import calendarSync from "./tasks/calendar-sync.js";
import linkedinNotificationsScan from "./tasks/linkedin-notifications-scan.js";
import signalDetection from "./tasks/signal-detection.js";
import morningBrief from "./tasks/morning-brief.js";
import voiceCorpusIndex from "./tasks/voice-corpus-index.js";
import contactAttributeExtraction from "./tasks/contact-attribute-extraction.js";
import graphEdgeExtraction from "./tasks/graph-edge-extraction.js";
import memorySynthesis from "./tasks/memory-synthesis.js";
import mentionExtraction from "./tasks/mention-extraction.js";
import observationsGeneration from "./tasks/observations-generation.js";
import inboxDraftPrepopulate from "./tasks/inbox-draft-prepopulate.js";
import inboxClassify from "./tasks/inbox-classify.js";
import extractLifeEvents from "./tasks/extract-life-events.js";
import feedAggregate from "./tasks/feed-aggregate.js";

// ─── WORKER_DATABASE_URL — direct connection only ──────────────────────
// graphile-worker uses named prepared statements internally. Postgres
// pgBouncer in transaction-pooling mode (port 6543 on Supabase) drops
// the underlying connection between statements, so the named statement
// hash is gone by the time graphile-worker tries to execute it — every
// other job fails with "prepared statement <hash> does not exist".
//
// WORKER_DATABASE_URL must point at the DIRECT connection (port 5432);
// the Next.js side keeps using DATABASE_URL on the transaction-pool
// connection (6543) because Prisma's PrismaPg adapter handles the
// session loss correctly.
const connectionString =
  process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[worker] DATABASE_URL (or WORKER_DATABASE_URL) is required");
  process.exit(1);
}

// Programmatic taskList — graphile-worker's directory loader doesn't
// pick up .ts files natively. Importing here means tsx (or the
// compiled JS bundle in production) resolves them through normal
// module loading.
const taskList = {
  "embedding-refresh": embeddingRefresh,
  "watch-renew": watchRenew,
  "circle-google-sync": circleGoogleSync,
  "openalex-affiliation-diff": openAlexAffiliationDiff,
  "gmail-sync": gmailSync,
  "calendar-sync": calendarSync,
  "linkedin-notifications-scan": linkedinNotificationsScan,
  "signal-detection": signalDetection,
  "morning-brief": morningBrief,
  "voice-corpus-index": voiceCorpusIndex,
  "contact-attribute-extraction": contactAttributeExtraction,
  "graph-edge-extraction": graphEdgeExtraction,
  "memory-synthesis": memorySynthesis,
  "mention-extraction": mentionExtraction,
  "observations-generation": observationsGeneration,
  "inbox-draft-prepopulate": inboxDraftPrepopulate,
  "inbox-classify": inboxClassify,
  "extract-life-events": extractLifeEvents,
  "feed-aggregate": feedAggregate,
};

// Crontab entries follow standard cron syntax; the third comma-separated
// field is task name, fourth is JSON payload. See
// https://worker.graphile.org/docs/cron for the full grammar.
const crontab = `
# minute / hour / day / month / dow  task-name  payload
# Every 5 minutes: re-evaluate which contacts need re-embedding.
*/5 * * * * embedding-refresh
# Every 6 days at 03:17 UTC: renew Gmail/Calendar push channels.
17 3 */6 * * watch-renew
# Nightly at 04:11 UTC: push CRM Circles → Google contact groups.
11 4 * * * circle-google-sync
# Nightly at 04:33 UTC: detect OpenAlex affiliation changes for tracked
# researcher contacts.
33 4 * * * openalex-affiliation-diff
# Every 3 minutes: incremental Gmail sync (server-side counterpart to
# the browser useAutoSync poll; once useAutoSync is retired, this is
# the only Gmail-sync trigger).
*/3 * * * * gmail-sync
# Every 30 minutes: Calendar sync.
*/30 * * * * calendar-sync
# Nightly at 04:55 UTC: scan recent LinkedIn notification emails for
# job-change / promotion signals → ContactChangelog rows.
55 4 * * * linkedin-notifications-scan
# Weekly Mon 05:11 UTC: Brave Search for recent news mentions of
# INNER_CIRCLE contacts → NEWS_MENTION ContactChangelog rows.
11 5 * * 1 signal-detection
# Weekdays at 13:30 UTC (6:30am Pacific): assemble today's morning brief
# (priorities + meetings + moment-to-connect + overnight signals) and
# save as a Gmail draft for the user to skim & send.
30 13 * * 1-5 morning-brief
# Weekly Sun 09:42 UTC: top up the voice corpus with recently-sent mail.
# Idempotent — only fetches bodies + extracts features for emails that
# don't already have a VoiceExample row.
42 9 * * 0 voice-corpus-index
# Daily at 02:00 UTC: re-extract ContactProfile for contacts that have
# accumulated ≥10 new interactions since last extraction (or have
# never been profiled). 50 contacts per run, prioritized by recency.
0 2 * * * contact-attribute-extraction
# Daily at 02:30 UTC: recompute ContactEdge graph (mutual-thread,
# same-org). Runs after contact-attribute-extraction so contact data
# is freshest.
30 2 * * * graph-edge-extraction
# Daily at 03:00 UTC: re-synthesize ContactMemory for contacts with
# ≥5 new interactions since last synthesis. 30 contacts per run,
# Claude Sonnet per call.
0 3 * * * memory-synthesis
# Daily at 03:30 UTC: extract mentions from outbound email bodies
# via Claude Haiku. 50 emails per run, accumulates "mentioned" edges
# in ContactEdge. Chews through backlog over weeks.
30 3 * * * mention-extraction
# Daily at 06:00 UTC: generate 1-3 assistant observations per user
# from recent signals (unanswered inbound, stale open threads,
# life events, dormant inner-circle). Surfaces on the dashboard.
0 6 * * * observations-generation
# Daily at 04:00 UTC: pre-populate Draft queue from OPEN inbox items.
# 20 items/run @ ~$0.01/item = ~$0.20/day. Sits between
# memory-synthesis (03:00) and observations-generation (06:00) so
# the queue is fresh by the morning brief.
0 4 * * * inbox-draft-prepopulate
# Every 4 hours: extract life events from the inbound EmailMessage
# backlog (Haiku, batch of 25). Lightweight enough to run often;
# new emails ingested via gmail-sync also enqueue per-message jobs.
17 */4 * * * extract-life-events
# Daily at 04:30 UTC: aggregate FeedItem rows from ContactChangelog +
# LifeEventSignal. Runs right after the life-event extractor so the
# /feed page reflects the latest signals by the morning brief.
30 4 * * * feed-aggregate
`.trim();

async function main() {
  const runner = await run({
    connectionString,
    concurrency: 4,
    pollInterval: 2000,
    noHandleSignals: false,
    crontab,
    taskList,
  });

  console.log(
    `[worker] Started. Concurrency=4, pollInterval=2000ms, tasks=${Object.keys(taskList).join(", ")}`,
  );
  await runner.promise;
}

main().catch((err) => {
  console.error("[worker] Fatal:", err);
  process.exit(1);
});
