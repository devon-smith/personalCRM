import { prisma } from "@/lib/prisma";
import { getAllGoogleAccessTokens } from "@/lib/gmail/client";

// ─── Types ───

interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{
    email: string;
    displayName?: string;
    self?: boolean;
    responseStatus?: string;
  }>;
  organizer?: { email: string; displayName?: string; self?: boolean };
  status?: string;
  htmlLink?: string;
}

interface CalendarListResponse {
  items?: CalendarEvent[];
  nextPageToken?: string;
}

export interface UpcomingEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string | null;
  attendees: Array<{
    email: string;
    name: string | null;
    contactId: string | null;
  }>;
  htmlLink: string | null;
}

export interface CalendarSyncResult {
  eventsScanned: number;
  interactionsLogged: number;
  interactionsExisted: number;
  contactsMatched: number;
}

// ─── Helpers ───

/**
 * Build a set of all email addresses belonging to the user
 * (primary + additional from GmailSyncState).
 */
async function getUserEmailSet(userId: string): Promise<Set<string>> {
  const [user, syncState] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    prisma.gmailSyncState.findUnique({
      where: { userId },
      select: { additionalUserEmails: true },
    }),
  ]);

  const emails = new Set<string>();
  if (user?.email) emails.add(user.email.toLowerCase());
  for (const e of syncState?.additionalUserEmails ?? []) {
    emails.add(e.toLowerCase());
  }
  return emails;
}

// ─── Fetch events ───

/**
 * Fetch calendar events within a time range from ALL linked Google accounts.
 * Merges and deduplicates events across accounts by event ID.
 */
async function fetchCalendarEvents(
  userId: string,
  timeMin: Date,
  timeMax: Date,
  maxResults: number = 250,
): Promise<CalendarEvent[]> {
  const accountTokens = await getAllGoogleAccessTokens(userId);
  if (accountTokens.length === 0) {
    throw new Error("No valid Google access token. User may need to reconnect.");
  }

  const eventMap = new Map<string, CalendarEvent>();
  let anySucceeded = false;
  let lastError: Error | null = null;

  // Fetch from each account and merge
  for (const { token } of accountTokens) {
    try {
      const events = await fetchCalendarEventsWithToken(token, timeMin, timeMax, maxResults);
      anySucceeded = true;
      for (const event of events) {
        // Deduplicate — same event appears on multiple calendars if both accounts are invited
        if (!eventMap.has(event.id)) {
          eventMap.set(event.id, event);
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Permission errors are expected for accounts without calendar scope — skip
      if (lastError.message.includes("access denied") || lastError.message.includes("not enabled")) {
        continue;
      }
      // For other errors, skip this account but keep trying others
      console.error("Calendar fetch error for account:", lastError.message);
    }
  }

  if (!anySucceeded) {
    throw lastError ?? new Error("Calendar access denied. Please reconnect Google from the Integrations page.");
  }

  // Sort merged events by start time
  return Array.from(eventMap.values())
    .sort((a, b) => {
      const aTime = a.start?.dateTime ?? a.start?.date ?? "";
      const bTime = b.start?.dateTime ?? b.start?.date ?? "";
      return aTime.localeCompare(bTime);
    })
    .slice(0, maxResults);
}

async function fetchCalendarEventsWithToken(
  token: string,
  timeMin: Date,
  timeMax: Date,
  maxResults: number,
): Promise<CalendarEvent[]> {
  const allEvents: CalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    );
    url.searchParams.set("timeMin", timeMin.toISOString());
    url.searchParams.set("timeMax", timeMax.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", String(Math.min(maxResults - allEvents.length, 250)));
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (res.status === 403) {
        const body = await res.text();
        if (body.includes("has not been used in project") || body.includes("it is disabled")) {
          throw new Error(
            "Google Calendar API is not enabled in your Google Cloud project. " +
            "Enable it at console.cloud.google.com under APIs & Services.",
          );
        }
        throw new Error(
          "Calendar access denied. Please reconnect Google from the Integrations page.",
        );
      }
      throw new Error(`Calendar API error: ${res.status}`);
    }

    const data = (await res.json()) as CalendarListResponse;
    if (data.items) {
      allEvents.push(...data.items);
    }

    pageToken = data.nextPageToken;
  } while (pageToken && allEvents.length < maxResults);

  return allEvents;
}

/**
 * Get the start time of an event as a Date.
 */
function getEventTime(event: CalendarEvent): Date | null {
  const raw = event.start?.dateTime ?? event.start?.date;
  return raw ? new Date(raw) : null;
}

/**
 * Get the end time of an event as a Date.
 */
function getEventEndTime(event: CalendarEvent): Date | null {
  const raw = event.end?.dateTime ?? event.end?.date;
  return raw ? new Date(raw) : null;
}

// ─── Upcoming events ───

/**
 * Fetch upcoming calendar events and match attendees to contacts.
 */
export async function getUpcomingEvents(
  userId: string,
  days: number = 7,
): Promise<UpcomingEvent[]> {
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const events = await fetchCalendarEvents(userId, now, future, 50);

  // Load contacts for attendee matching
  const contacts = await prisma.contact.findMany({
    where: { userId, email: { not: null } },
    select: { id: true, email: true, name: true },
  });
  const contactByEmail = new Map(
    contacts.map((c) => [c.email!.toLowerCase(), { id: c.id, name: c.name }]),
  );

  // Build set of ALL user emails to exclude from attendees
  const userEmails = await getUserEmailSet(userId);

  const upcoming: UpcomingEvent[] = [];

  for (const event of events) {
    if (event.status === "cancelled") continue;

    const startTime = getEventTime(event);
    if (!startTime) continue;

    const endTime = getEventEndTime(event);

    // Match attendees to contacts, excluding all user's own emails
    const attendees = (event.attendees ?? [])
      .filter((a) => !a.self && !userEmails.has(a.email.toLowerCase()))
      .map((a) => {
        const contact = contactByEmail.get(a.email.toLowerCase());
        return {
          email: a.email,
          name: a.displayName ?? contact?.name ?? null,
          contactId: contact?.id ?? null,
        };
      });

    upcoming.push({
      id: event.id,
      title: event.summary ?? "(No title)",
      startTime: startTime.toISOString(),
      endTime: endTime?.toISOString() ?? null,
      attendees,
      htmlLink: event.htmlLink ?? null,
    });
  }

  return upcoming;
}

// ─── Sync past events as interactions ───

/**
 * Sync past calendar events as MEETING interactions.
 * Matches event attendees to contacts by email.
 */
export async function syncCalendarEvents(
  userId: string,
  days: number = 90,
): Promise<CalendarSyncResult> {
  const now = new Date();
  const past = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const events = await fetchCalendarEvents(userId, past, now, 500);

  // Load contacts for attendee matching
  const contacts = await prisma.contact.findMany({
    where: { userId, email: { not: null } },
    select: { id: true, email: true, name: true },
  });
  const contactByEmail = new Map(
    contacts.map((c) => [c.email!.toLowerCase(), c.id]),
  );

  // Load existing interactions to avoid duplicates (sourceId = "cal:{eventId}")
  const existingSourceIds = new Set(
    (
      await prisma.interaction.findMany({
        where: { userId, sourceId: { startsWith: "cal:" } },
        select: { sourceId: true },
      })
    ).map((i) => i.sourceId),
  );

  // Build set of ALL user emails to exclude from attendees
  const userEmails = await getUserEmailSet(userId);

  let eventsScanned = 0;
  let interactionsLogged = 0;
  let interactionsExisted = 0;
  const matchedContactIds = new Set<string>();

  for (const event of events) {
    if (event.status === "cancelled") continue;
    eventsScanned++;

    const eventTime = getEventTime(event);
    if (!eventTime) continue;

    // Find attendees that match our contacts (excluding all user emails)
    const attendeeEmails = (event.attendees ?? [])
      .filter((a) => !a.self && !userEmails.has(a.email.toLowerCase()))
      .map((a) => a.email.toLowerCase());

    // Also check the organizer if it's not one of our accounts
    if (
      event.organizer &&
      !event.organizer.self &&
      !userEmails.has(event.organizer.email.toLowerCase())
    ) {
      attendeeEmails.push(event.organizer.email.toLowerCase());
    }

    // Create an interaction for each matched contact
    for (const email of attendeeEmails) {
      const contactId = contactByEmail.get(email);
      if (!contactId) continue;

      matchedContactIds.add(contactId);

      const sourceId = `cal:${event.id}:${contactId}`;

      if (existingSourceIds.has(sourceId)) {
        interactionsExisted++;
        continue;
      }

      // Determine if user organized this meeting
      const isOrganizer = event.organizer?.self ?? false;

      await prisma.interaction.create({
        data: {
          userId,
          contactId,
          type: "MEETING",
          direction: isOrganizer ? "OUTBOUND" : "INBOUND",
          channel: "Google Calendar",
          subject: event.summary ?? null,
          summary: buildMeetingSummary(event, email),
          occurredAt: eventTime,
          sourceId,
        },
      });

      // Update lastInteraction on the contact if this is more recent
      await prisma.contact.update({
        where: { id: contactId },
        data: {
          lastInteraction: eventTime,
        },
      });

      interactionsLogged++;
      existingSourceIds.add(sourceId);
    }
  }

  return {
    eventsScanned,
    interactionsLogged,
    interactionsExisted,
    contactsMatched: matchedContactIds.size,
  };
}

/**
 * Build a brief summary for a calendar meeting interaction.
 */
function buildMeetingSummary(
  event: CalendarEvent,
  attendeeEmail: string,
): string {
  const parts: string[] = [];

  if (event.summary) {
    parts.push(event.summary);
  }

  const attendeeCount = (event.attendees ?? []).filter((a) => !a.self).length;
  if (attendeeCount > 1) {
    parts.push(`(${attendeeCount} attendees)`);
  }

  return parts.join(" ") || "Calendar meeting";
}
