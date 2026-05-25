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
// Load .env.local first (Next.js convention, overrides .env), then .env.
// Default `import "dotenv/config"` only loads .env, which silently drops vars
// the user only set in .env.local — caused signal-detection to no-op when
// BRAVE_API_KEY lived only in .env.local.
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

// WORKER_DATABASE_URL takes precedence so the worker can talk to the direct
// connection (port 5432) when the pooler (6543) hits its session limit. The
// Next.js side still uses DATABASE_URL.
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
