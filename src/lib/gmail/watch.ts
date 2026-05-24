/**
 * Gmail watch lifecycle (Milestone 1.2). Establishes a Pub/Sub watch
 * on a user's mailbox so Google pushes change notifications to our
 * webhook instead of us polling.
 *
 * Watches expire after 7 days; the worker `watch-renew` task is
 * scheduled to re-establish every 6 days. Each call to users.watch
 * REPLACES any prior watch — no need to stop the old one first.
 *
 * https://developers.google.com/gmail/api/guides/push
 *
 * Required env: GMAIL_PUBSUB_TOPIC (e.g.
 * "projects/your-gcp-project/topics/gmail-updates"). Returns null
 * when unset — callers should surface this as "push not configured"
 * rather than failing.
 */

import { prisma } from "@/lib/prisma";
import { googleFetch } from "./client";

export interface GmailWatchResult {
  historyId: string;
  expiration: Date;
}

/**
 * Establish (or re-establish) a Gmail watch for the user. Idempotent:
 * Google overwrites any prior watch for this mailbox.
 */
export async function establishGmailWatch(
  userId: string,
): Promise<GmailWatchResult | null> {
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topic) return null;

  const res = await googleFetch(
    userId,
    "https://gmail.googleapis.com/gmail/v1/users/me/watch",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topicName: topic,
        labelIds: ["INBOX", "SENT"],
        labelFilterBehavior: "INCLUDE",
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`gmail.users.watch ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { historyId: string; expiration: string };
  // expiration is unix-ms as a string — yes, really.
  const expiration = new Date(parseInt(data.expiration, 10));

  await prisma.gmailSyncState.upsert({
    where: { userId },
    create: {
      userId,
      historyId: data.historyId,
      watchExpiration: expiration,
      syncEnabled: true,
    },
    update: {
      historyId: data.historyId,
      watchExpiration: expiration,
    },
  });

  return { historyId: data.historyId, expiration };
}

/** Stop the active Gmail watch. Used during teardown / scope changes. */
export async function stopGmailWatch(userId: string): Promise<void> {
  const res = await googleFetch(
    userId,
    "https://gmail.googleapis.com/gmail/v1/users/me/stop",
    { method: "POST" },
  );
  // 204 is the success response; 404 means nothing to stop (also fine).
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(`gmail.users.stop ${res.status}: ${body.slice(0, 200)}`);
  }
  await prisma.gmailSyncState
    .update({
      where: { userId },
      data: { watchExpiration: null },
    })
    .catch(() => {});
}
