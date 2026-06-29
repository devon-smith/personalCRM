/**
 * Google Calendar watch lifecycle (Milestone 1.3). Each calendar gets
 * its own watch channel — when an event changes Google POSTs to our
 * webhook with X-Goog-* headers. We then trigger syncCalendarEvents
 * for that user.
 *
 * Watches expire (default ~30 days, max configurable). The worker
 * watch-renew task re-establishes any channel inside its 2x-cadence
 * grace window.
 *
 * https://developers.google.com/calendar/api/guides/push
 *
 * Required env:
 *   - WEBHOOK_BASE_URL: public https URL of the CRM (Google requires
 *     https + a domain it can resolve; ngrok works for local dev).
 *   - WEBHOOK_TOKEN: shared secret added to the webhook path so random
 *     internet hits don't trigger sync.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { googleFetchWithToken, getAllGoogleAccessTokens } from "@/lib/gmail/client";

export interface CalendarWatchResult {
  accountId: string;
  calendarId: string;
  channelId: string;
  resourceId: string;
  expiration: Date;
}

/**
 * Establish watches for the user's primary calendar on every linked
 * Google account. Returns one result per (account, calendar) pair.
 *
 * No-op (returns []) when WEBHOOK_BASE_URL / WEBHOOK_TOKEN aren't set
 * — push isn't configured.
 */
export async function establishCalendarWatches(
  userId: string,
  calendarIds: string[] = ["primary"],
): Promise<CalendarWatchResult[]> {
  const base = process.env.WEBHOOK_BASE_URL;
  const token = process.env.WEBHOOK_TOKEN;
  if (!base || !token) return [];

  const accountTokens = await getAllGoogleAccessTokens(userId);
  if (accountTokens.length === 0) return [];

  const callbackUrl = `${base.replace(/\/$/, "")}/api/webhooks/calendar/${token}`;

  const out: CalendarWatchResult[] = [];
  for (const { accountId, token: accessToken } of accountTokens) {
    for (const calendarId of calendarIds) {
      try {
        // Stop any existing channel for this (account, calendar) so we
        // don't pile up zombie watches when this runs multiple times.
        await stopWatchIfExists(accessToken, userId, accountId, calendarId);

        const channelId = randomUUID();
        const res = await googleFetchWithToken(
          accessToken,
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: channelId,
              type: "web_hook",
              address: callbackUrl,
              token, // arrives as X-Goog-Channel-Token; we re-validate
            }),
          },
          {
            userId,
            service: "calendar",
            operation: "calendar.events.watch",
            feature: "calendar_watch_setup",
            metadata: {
              accountId,
              calendarId,
            },
          },
        );

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`calendar.events.watch ${res.status}: ${body.slice(0, 200)}`);
        }

        const data = (await res.json()) as {
          id: string;
          resourceId: string;
          expiration?: string;
        };
        // expiration is unix-ms as a string; default to +7d if missing.
        const expiration = data.expiration
          ? new Date(parseInt(data.expiration, 10))
          : new Date(Date.now() + 7 * 86_400_000);

        await prisma.calendarWatchChannel.upsert({
          where: { accountId_calendarId: { accountId, calendarId } },
          create: {
            userId,
            accountId,
            calendarId,
            channelId: data.id,
            resourceId: data.resourceId,
            expiration,
          },
          update: {
            channelId: data.id,
            resourceId: data.resourceId,
            expiration,
          },
        });

        out.push({
          accountId,
          calendarId,
          channelId: data.id,
          resourceId: data.resourceId,
          expiration,
        });
      } catch (err) {
        console.error(
          `[calendar-watch] establish failed for ${accountId}/${calendarId}:`,
          err,
        );
      }
    }
  }
  return out;
}

async function stopWatchIfExists(
  accessToken: string,
  userId: string,
  accountId: string,
  calendarId: string,
): Promise<void> {
  const existing = await prisma.calendarWatchChannel.findUnique({
    where: { accountId_calendarId: { accountId, calendarId } },
  });
  if (!existing) return;

  const res = await googleFetchWithToken(
    accessToken,
    "https://www.googleapis.com/calendar/v3/channels/stop",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: existing.channelId,
        resourceId: existing.resourceId,
      }),
    },
    {
      userId,
      service: "calendar",
      operation: "calendar.channels.stop",
      feature: "calendar_watch_setup",
      metadata: {
        accountId,
        calendarId,
      },
    },
  );
  // 200, 204, or 404 are all "channel is gone now" outcomes.
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    console.warn(`[calendar-watch] stop ${res.status}: ${body.slice(0, 200)}`);
  }
  await prisma.calendarWatchChannel
    .delete({ where: { accountId_calendarId: { accountId, calendarId } } })
    .catch(() => {});
}
