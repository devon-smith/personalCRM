import { prisma } from "@/lib/prisma";
import { googleFetch } from "@/lib/gmail/client";

interface CalendarEvent {
  readonly summary?: string;
  readonly start?: { readonly date?: string; readonly dateTime?: string };
  readonly description?: string;
  readonly recurrence?: readonly string[];
  readonly eventType?: string;
}

interface CalendarListResponse {
  readonly items?: readonly CalendarEvent[];
  readonly nextPageToken?: string;
}

export interface BirthdaySyncEntry {
  readonly name: string;
  readonly birthday: string; // ISO date string
}

export interface BirthdaySyncResult {
  readonly scanned: number;
  readonly matched: number;
  readonly updated: number;
  readonly alreadyHad: number;
  readonly entries: readonly BirthdaySyncEntry[];
}

/**
 * Scan Google Calendar for birthday events and match them to contacts.
 * Google Calendar auto-generates birthday events from Google Contacts
 * in a special "Birthdays" calendar (#contacts@group.v.calendar.google.com).
 */
export async function syncBirthdaysFromCalendar(
  userId: string,
): Promise<BirthdaySyncResult> {
  // Fetch birthday events from the Birthdays calendar
  const birthdayEvents = await fetchBirthdayEvents(userId);

  if (birthdayEvents.length === 0) {
    return { scanned: 0, matched: 0, updated: 0, alreadyHad: 0, entries: [] };
  }

  // Load all contacts for matching
  const contacts = await prisma.contact.findMany({
    where: { userId },
    select: { id: true, name: true, birthday: true },
  });

  // Build name lookup (lowercased for fuzzy matching)
  const contactByName = new Map<string, { id: string; birthday: Date | null }>();
  for (const c of contacts) {
    contactByName.set(c.name.toLowerCase().trim(), {
      id: c.id,
      birthday: c.birthday,
    });
  }

  let matched = 0;
  let updated = 0;
  let alreadyHad = 0;
  const entries: BirthdaySyncEntry[] = [];

  for (const event of birthdayEvents) {
    const parsed = parseBirthdayEvent(event);
    if (!parsed) continue;

    const contactKey = parsed.name.toLowerCase().trim();
    const contact = contactByName.get(contactKey);
    if (!contact) continue;

    matched++;

    if (contact.birthday) {
      alreadyHad++;
      continue;
    }

    // Save the birthday
    await prisma.contact.update({
      where: { id: contact.id },
      data: { birthday: parsed.date },
    });
    updated++;
    entries.push({
      name: parsed.name,
      birthday: parsed.date.toISOString().split("T")[0],
    });
  }

  return {
    scanned: birthdayEvents.length,
    matched,
    updated,
    alreadyHad,
    entries,
  };
}

async function fetchBirthdayEvents(
  userId: string,
): Promise<readonly CalendarEvent[]> {
  const allEvents: CalendarEvent[] = [];

  // Try the dedicated Birthdays calendar first
  const calendarIds = [
    encodeURIComponent("#contacts@group.v.calendar.google.com"),
    "primary",
  ];

  for (const calendarId of calendarIds) {
    try {
      const events = await fetchFromCalendar(userId, calendarId);
      if (events.length > 0) {
        allEvents.push(...events);
        // If we got results from Birthdays calendar, no need for primary
        if (calendarId.includes("contacts")) break;
      }
    } catch {
      // Calendar might not exist, continue
    }
  }

  return allEvents;
}

async function fetchFromCalendar(
  userId: string,
  calendarId: string,
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;

  // Search a wide window (current year) for birthday events
  const year = new Date().getFullYear();
  const timeMin = new Date(year, 0, 1).toISOString();
  const timeMax = new Date(year, 11, 31).toISOString();

  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
    );
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("maxResults", "250");
    if (calendarId === "primary") {
      // On primary calendar, filter for birthday-related events
      url.searchParams.set("q", "birthday");
    }
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await googleFetch(userId, url.toString());
    if (!res.ok) break;

    const data = (await res.json()) as CalendarListResponse;
    if (data.items) events.push(...data.items);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}

function parseBirthdayEvent(
  event: CalendarEvent,
): { name: string; date: Date } | null {
  const summary = event.summary?.trim();
  if (!summary) return null;

  // Google birthday events are formatted as "Name's birthday"
  // or "Birthday - Name" or just contain "birthday"
  let name: string | null = null;

  if (summary.toLowerCase().endsWith("'s birthday")) {
    name = summary.slice(0, -"'s birthday".length).trim();
  } else if (summary.toLowerCase().endsWith("'s birthday")) {
    name = summary.slice(0, -"'s birthday".length).trim();
  } else if (summary.toLowerCase().startsWith("birthday - ")) {
    name = summary.slice("birthday - ".length).trim();
  } else if (summary.toLowerCase().includes("birthday")) {
    // Try to extract name by removing "birthday" and common words
    name = summary
      .replace(/birthday/i, "")
      .replace(/[-–—:]/g, "")
      .trim();
  }

  if (!name || name.length < 2) return null;

  // Get the date from the event
  const dateStr = event.start?.date ?? event.start?.dateTime;
  if (!dateStr) return null;

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;

  return { name, date };
}
