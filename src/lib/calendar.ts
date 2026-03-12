import { prisma } from "@/lib/prisma";
import { googleFetch } from "@/lib/gmail/client";

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

// ─── Fetch events ───

/**
 * Fetch calendar events within a time range.
 */
async function fetchCalendarEvents(
  userId: string,
  timeMin: Date,
  timeMax: Date,
  maxResults: number = 250,
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

    const res = await googleFetch(userId, url.toString());
    if (!res.ok) {
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

  // Get user's email to exclude self
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const userEmail = user?.email?.toLowerCase();

  const upcoming: UpcomingEvent[] = [];

  for (const event of events) {
    if (event.status === "cancelled") continue;

    const startTime = getEventTime(event);
    if (!startTime) continue;

    const endTime = getEventEndTime(event);

    // Match attendees to contacts
    const attendees = (event.attendees ?? [])
      .filter((a) => !a.self && a.email.toLowerCase() !== userEmail)
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

  // Get user's email
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const userEmail = user?.email?.toLowerCase();

  let eventsScanned = 0;
  let interactionsLogged = 0;
  let interactionsExisted = 0;
  const matchedContactIds = new Set<string>();

  for (const event of events) {
    if (event.status === "cancelled") continue;
    eventsScanned++;

    const eventTime = getEventTime(event);
    if (!eventTime) continue;

    // Find attendees that match our contacts (excluding self)
    const attendeeEmails = (event.attendees ?? [])
      .filter((a) => !a.self && a.email.toLowerCase() !== userEmail)
      .map((a) => a.email.toLowerCase());

    // Also check the organizer if it's not us
    if (
      event.organizer &&
      !event.organizer.self &&
      event.organizer.email.toLowerCase() !== userEmail
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
