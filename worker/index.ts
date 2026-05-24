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
import "dotenv/config";
import { run } from "graphile-worker";
import embeddingRefresh from "./tasks/embedding-refresh.js";
import watchRenew from "./tasks/watch-renew.js";
import circleGoogleSync from "./tasks/circle-google-sync.js";
import openAlexAffiliationDiff from "./tasks/openalex-affiliation-diff.js";
import gmailSync from "./tasks/gmail-sync.js";
import calendarSync from "./tasks/calendar-sync.js";
import linkedinNotificationsScan from "./tasks/linkedin-notifications-scan.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[worker] DATABASE_URL is required");
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
