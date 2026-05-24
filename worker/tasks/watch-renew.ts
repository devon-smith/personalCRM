/**
 * Renew Gmail + Calendar Pub/Sub watch channels.
 *
 * Stub today — actual watch.create wiring lands with Milestones 1.2/1.3
 * (push sync). The cron entry exists so the slot is reserved and the
 * worker process exercises the cron path before those land.
 *
 * Once Pub/Sub is provisioned this task will:
 *   1. List all linked Google accounts.
 *   2. For each account: call users.watch on Gmail and events.watch on
 *      Calendar with the configured Pub/Sub topic.
 *   3. Update SyncLog with renewal outcomes.
 */
import type { Task } from "graphile-worker";

const watchRenew: Task = async (_payload, helpers) => {
  helpers.logger.info("watch-renew: stub — wires up with Phase 1.2/1.3");
};

export default watchRenew;
