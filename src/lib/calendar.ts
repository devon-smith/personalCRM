import { prisma } from "@/lib/prisma";
import { getAllGoogleAccessTokens, googleFetchWithToken } from "@/lib/gmail/client";

// ─── Types ───

interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
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
  description: string | null;
  location: string | null;
  allDay: boolean;
  startTime: string;
  endTime: string | null;
  organizer: {
    email: string | null;
    name: string | null;
    self: boolean;
  } | null;
  attendees: Array<{
    email: string;
    name: string | null;
    contactId: string | null;
    responseStatus: string | null;
    company: string | null;
    role: string | null;
    lastInteraction: string | null;
    circles: Array<{ id: string; name: string; color: string }>;
    facts: Array<{ id: string; type: string; value: string; observedAt: string }>;
    memory: {
      openThreads: Array<Record<string, unknown>>;
      recurringThemes: string[];
      personalContext: Record<string, unknown>;
    } | null;
    profile: {
      expertiseAreas: string[];
      relationshipStage: string | null;
      communicationStyle: Record<string, unknown> | null;
    } | null;
    recentInteractions: Array<{
      id: string;
      type: string;
      direction: string;
      occurredAt: string;
      subject: string | null;
      summary: string | null;
    }>;
  }>;
  prep: {
    knownAttendees: number;
    unknownAttendees: number;
    openThreads: number;
    facts: number;
    recentInteractions: number;
    lastMetAt: string | null;
    summary: string;
  };
  htmlLink: string | null;
}

export interface CalendarSyncResult {
  eventsScanned: number;
  interactionsLogged: number;
  interactionsExisted: number;
  contactsMatched: number;
}

const UPCOMING_EVENTS_CACHE_TTL_MS = 60 * 1000;
const MAX_UPCOMING_EVENTS_CACHE_ENTRIES = 100;

const upcomingEventsCache = new Map<
  string,
  {
    expiresAt: number;
    promise: Promise<UpcomingEvent[]>;
  }
>();

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
      const events = await fetchCalendarEventsWithToken(
        userId,
        token,
        timeMin,
        timeMax,
        maxResults,
      );
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
  userId: string,
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

    const res = await googleFetchWithToken(
      token,
      url.toString(),
      undefined,
      {
        userId,
        service: "calendar",
        operation: "calendar.events.list",
        feature: "calendar_events_fetch",
        metadata: {
          pageToken: Boolean(pageToken),
          maxResults,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
        },
      },
    );
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
  options: { cache?: boolean } = {},
): Promise<UpcomingEvent[]> {
  if (options.cache === false) {
    return loadUpcomingEvents(userId, days);
  }

  const key = `${userId}:${days}`;
  const now = Date.now();
  const cached = upcomingEventsCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = loadUpcomingEvents(userId, days).catch((error) => {
    if (upcomingEventsCache.get(key)?.promise === promise) {
      upcomingEventsCache.delete(key);
    }
    throw error;
  });
  upcomingEventsCache.set(key, {
    expiresAt: now + UPCOMING_EVENTS_CACHE_TTL_MS,
    promise,
  });
  trimUpcomingEventsCache(now);
  return promise;
}

export function clearUpcomingEventsCache(userId?: string): void {
  if (!userId) {
    upcomingEventsCache.clear();
    return;
  }
  for (const key of upcomingEventsCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      upcomingEventsCache.delete(key);
    }
  }
}

async function loadUpcomingEvents(
  userId: string,
  days: number,
): Promise<UpcomingEvent[]> {
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const events = await fetchCalendarEvents(userId, now, future, 50);

  // Build set of ALL user emails to exclude from attendees
  const userEmails = await getUserEmailSet(userId);

  const attendeeEmails = Array.from(
    new Set(
      events.flatMap((event) =>
        (event.attendees ?? [])
          .filter((a) => !a.self && !userEmails.has(a.email.toLowerCase()))
          .map((a) => a.email.toLowerCase()),
      ),
    ),
  );

  const contacts = attendeeEmails.length
    ? await prisma.contact.findMany({
        where: {
          userId,
          isNoise: false,
          OR: [
            { email: { in: attendeeEmails, mode: "insensitive" } },
            { additionalEmails: { hasSome: attendeeEmails } },
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          additionalEmails: true,
          company: true,
          role: true,
          lastInteraction: true,
          circles: {
            select: {
              circle: { select: { id: true, name: true, color: true } },
            },
          },
          personFacts: {
            where: { dismissedAt: null },
            orderBy: { observedAt: "desc" },
            take: 4,
            select: { id: true, type: true, value: true, observedAt: true },
          },
          interactions: {
            where: { sourceId: { not: { startsWith: "manual-reply:" } } },
            orderBy: { occurredAt: "desc" },
            take: 3,
            select: {
              id: true,
              type: true,
              direction: true,
              occurredAt: true,
              subject: true,
              summary: true,
            },
          },
          memory: {
            select: {
              openThreads: true,
              recurringThemes: true,
              personalContext: true,
            },
          },
          profile: {
            select: {
              expertiseAreas: true,
              relationshipStage: true,
              communicationStyle: true,
            },
          },
        },
      })
    : [];

  const contactByEmail = new Map<
    string,
    (typeof contacts)[number]
  >();
  for (const contact of contacts) {
    if (contact.email) contactByEmail.set(contact.email.toLowerCase(), contact);
    for (const email of contact.additionalEmails) {
      contactByEmail.set(email.toLowerCase(), contact);
    }
  }

  const upcoming: UpcomingEvent[] = [];

  for (const event of events) {
    if (event.status === "cancelled") continue;

    const startTime = getEventTime(event);
    if (!startTime) continue;

    const endTime = getEventEndTime(event);

    // Match attendees to contacts, excluding all user's own emails.
    const attendees = (event.attendees ?? [])
      .filter((a) => !a.self && !userEmails.has(a.email.toLowerCase()))
      .map((a) => {
        const contact = contactByEmail.get(a.email.toLowerCase());
        return {
          email: a.email,
          name: a.displayName ?? contact?.name ?? null,
          contactId: contact?.id ?? null,
          responseStatus: a.responseStatus ?? null,
          company: contact?.company ?? null,
          role: contact?.role ?? null,
          lastInteraction: contact?.lastInteraction?.toISOString() ?? null,
          circles:
            contact?.circles.map((cc) => ({
              id: cc.circle.id,
              name: cc.circle.name,
              color: cc.circle.color,
            })) ?? [],
          facts:
            contact?.personFacts.map((fact) => ({
              id: fact.id,
              type: fact.type,
              value: fact.value,
              observedAt: fact.observedAt.toISOString(),
            })) ?? [],
          memory: contact?.memory
            ? {
                openThreads: asRecordArray(contact.memory.openThreads),
                recurringThemes: contact.memory.recurringThemes,
                personalContext: asRecord(contact.memory.personalContext),
              }
            : null,
          profile: contact?.profile
            ? {
                expertiseAreas: contact.profile.expertiseAreas,
                relationshipStage: contact.profile.relationshipStage,
                communicationStyle: contact.profile.communicationStyle
                  ? asRecord(contact.profile.communicationStyle)
                  : null,
              }
            : null,
          recentInteractions:
            contact?.interactions.map((interaction) => ({
              id: interaction.id,
              type: interaction.type,
              direction: interaction.direction,
              occurredAt: interaction.occurredAt.toISOString(),
              subject: interaction.subject,
              summary: interaction.summary,
            })) ?? [],
        };
      });

    const prep = buildPrepSummary(attendees);

    upcoming.push({
      id: event.id,
      title: event.summary ?? "(No title)",
      description: cleanCalendarDescription(event.description),
      location: event.location ?? null,
      allDay: Boolean(event.start?.date && !event.start.dateTime),
      startTime: startTime.toISOString(),
      endTime: endTime?.toISOString() ?? null,
      organizer: event.organizer
        ? {
            email: event.organizer.email ?? null,
            name: event.organizer.displayName ?? null,
            self: event.organizer.self ?? false,
          }
        : null,
      attendees,
      prep,
      htmlLink: event.htmlLink ?? null,
    });
  }

  return upcoming;
}

function trimUpcomingEventsCache(now: number): void {
  for (const [key, value] of upcomingEventsCache) {
    if (value.expiresAt <= now) {
      upcomingEventsCache.delete(key);
    }
  }

  while (upcomingEventsCache.size > MAX_UPCOMING_EVENTS_CACHE_ENTRIES) {
    const oldestKey = upcomingEventsCache.keys().next().value;
    if (!oldestKey) break;
    upcomingEventsCache.delete(oldestKey);
  }
}

function cleanCalendarDescription(description: string | undefined): string | null {
  if (!description) return null;
  const cleaned = description
    .replace(/<[^>]*>/g, " ")
    .replace(/https:\/\/meet\.google\.com\/[a-z-]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 500) : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === "object" && !Array.isArray(item),
  );
}

function buildPrepSummary(attendees: UpcomingEvent["attendees"]): UpcomingEvent["prep"] {
  const knownAttendees = attendees.filter((a) => a.contactId);
  const facts = knownAttendees.reduce((sum, a) => sum + a.facts.length, 0);
  const openThreads = knownAttendees.reduce(
    (sum, a) => sum + (a.memory?.openThreads.length ?? 0),
    0,
  );
  const recentInteractions = knownAttendees.reduce(
    (sum, a) => sum + a.recentInteractions.length,
    0,
  );
  const lastMetAt = knownAttendees
    .flatMap((a) => a.recentInteractions)
    .filter((interaction) => interaction.type === "MEETING")
    .map((interaction) => interaction.occurredAt)
    .sort()
    .at(-1) ?? null;

  const firstKnown = knownAttendees[0];
  const parts: string[] = [];
  if (knownAttendees.length > 0) {
    parts.push(
      `${knownAttendees.length} known ${knownAttendees.length === 1 ? "attendee" : "attendees"}`,
    );
  }
  if (openThreads > 0) parts.push(`${openThreads} open thread${openThreads === 1 ? "" : "s"}`);
  if (facts > 0) parts.push(`${facts} saved fact${facts === 1 ? "" : "s"}`);
  if (recentInteractions > 0) {
    parts.push(`${recentInteractions} recent interaction${recentInteractions === 1 ? "" : "s"}`);
  }

  const summary =
    parts.length > 0
      ? `Prep has ${parts.join(", ")}${firstKnown?.name ? `, led by ${firstKnown.name}` : ""}.`
      : attendees.length > 0
        ? "Attendees are not matched to CRM contacts yet."
        : "No external attendees found on this event.";

  return {
    knownAttendees: knownAttendees.length,
    unknownAttendees: attendees.length - knownAttendees.length,
    openThreads,
    facts,
    recentInteractions,
    lastMetAt,
    summary,
  };
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
          summary: buildMeetingSummary(event),
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
function buildMeetingSummary(event: CalendarEvent): string {
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
