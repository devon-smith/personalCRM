import { prisma } from "@/lib/prisma";
import { googleFetch } from "@/lib/gmail/client";

export interface CalendarGap {
  readonly start: string; // ISO
  readonly end: string;
  readonly durationMinutes: number;
}

export interface SchedulingSuggestion {
  readonly contactId: string;
  readonly contactName: string;
  readonly company: string | null;
  readonly daysOverdue: number;
  readonly suggestedSlot: CalendarGap;
  readonly googleCalendarLink: string;
}

interface CalendarEvent {
  readonly start?: { readonly dateTime?: string; readonly date?: string };
  readonly end?: { readonly dateTime?: string; readonly date?: string };
  readonly status?: string;
}

/**
 * Find gaps in the user's Google Calendar over the next N days,
 * then match them with overdue contacts to suggest scheduling.
 */
export async function getSchedulingSuggestions(
  userId: string,
  lookAheadDays: number = 5,
  maxSuggestions: number = 5,
): Promise<readonly SchedulingSuggestion[]> {
  // 1. Fetch calendar events for the window
  const now = new Date();
  const future = new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);

  const events = await fetchEvents(userId, now, future);

  // 2. Find gaps (business hours only: 9am-6pm)
  const gaps = findCalendarGaps(events, now, future);

  if (gaps.length === 0) return [];

  // 3. Get overdue contacts sorted by urgency
  const overdueContacts = await getOverdueForScheduling(userId);

  if (overdueContacts.length === 0) return [];

  // 4. Match contacts to gaps
  const suggestions: SchedulingSuggestion[] = [];
  const usedGaps = new Set<number>();

  for (const contact of overdueContacts) {
    if (suggestions.length >= maxSuggestions) break;

    // Find a 30-min gap that hasn't been used
    const gapIdx = gaps.findIndex(
      (g, i) => !usedGaps.has(i) && g.durationMinutes >= 30,
    );
    if (gapIdx === -1) break;

    usedGaps.add(gapIdx);
    const gap = gaps[gapIdx];

    // Create a 30-minute slot at the start of the gap
    const slotEnd = new Date(
      new Date(gap.start).getTime() + 30 * 60 * 1000,
    ).toISOString();

    const slot: CalendarGap = {
      start: gap.start,
      end: slotEnd,
      durationMinutes: 30,
    };

    suggestions.push({
      contactId: contact.id,
      contactName: contact.name,
      company: contact.company,
      daysOverdue: contact.daysOverdue,
      suggestedSlot: slot,
      googleCalendarLink: buildGoogleCalendarLink(
        `Catch up with ${contact.name}`,
        slot.start,
        slot.end,
      ),
    });
  }

  return suggestions;
}

async function fetchEvents(
  userId: string,
  timeMin: Date,
  timeMax: Date,
): Promise<readonly CalendarEvent[]> {
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
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await googleFetch(userId, url.toString());
    if (!res.ok) break;

    const data = await res.json();
    if (data.items) allEvents.push(...data.items);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allEvents;
}

/**
 * Find free slots during business hours (9 AM - 6 PM) between calendar events.
 */
function findCalendarGaps(
  events: readonly CalendarEvent[],
  windowStart: Date,
  windowEnd: Date,
): readonly CalendarGap[] {
  // Parse events into sorted time blocks
  const blocks: Array<{ start: number; end: number }> = [];

  for (const ev of events) {
    if (ev.status === "cancelled") continue;
    const start = ev.start?.dateTime ?? ev.start?.date;
    const end = ev.end?.dateTime ?? ev.end?.date;
    if (!start || !end) continue;
    blocks.push({ start: new Date(start).getTime(), end: new Date(end).getTime() });
  }

  blocks.sort((a, b) => a.start - b.start);

  const gaps: CalendarGap[] = [];
  const dayMs = 24 * 60 * 60 * 1000;

  // Walk through each day in the window
  const startDay = new Date(windowStart);
  startDay.setHours(0, 0, 0, 0);

  for (
    let day = startDay.getTime();
    day < windowEnd.getTime();
    day += dayMs
  ) {
    const dayDate = new Date(day);
    const dayOfWeek = dayDate.getDay();

    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const businessStart = new Date(day);
    businessStart.setHours(9, 0, 0, 0);
    const businessEnd = new Date(day);
    businessEnd.setHours(18, 0, 0, 0);

    // Don't suggest slots in the past
    const effectiveStart = Math.max(businessStart.getTime(), windowStart.getTime());
    if (effectiveStart >= businessEnd.getTime()) continue;

    // Get events for this day
    const dayBlocks = blocks.filter(
      (b) => b.end > effectiveStart && b.start < businessEnd.getTime(),
    );

    // Find gaps between events
    let cursor = effectiveStart;

    for (const block of dayBlocks) {
      if (block.start > cursor) {
        const gapMinutes = Math.floor((block.start - cursor) / (60 * 1000));
        if (gapMinutes >= 30) {
          gaps.push({
            start: new Date(cursor).toISOString(),
            end: new Date(block.start).toISOString(),
            durationMinutes: gapMinutes,
          });
        }
      }
      cursor = Math.max(cursor, block.end);
    }

    // Gap after last event until end of business hours
    if (cursor < businessEnd.getTime()) {
      const gapMinutes = Math.floor((businessEnd.getTime() - cursor) / (60 * 1000));
      if (gapMinutes >= 30) {
        gaps.push({
          start: new Date(cursor).toISOString(),
          end: businessEnd.toISOString(),
          durationMinutes: gapMinutes,
        });
      }
    }
  }

  return gaps;
}

async function getOverdueForScheduling(userId: string) {
  const now = new Date();

  const contacts = await prisma.contact.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      company: true,
      tier: true,
      followUpDays: true,
      lastInteraction: true,
      importedAt: true,
    },
  });

  const DEFAULT_CADENCE: Record<string, number> = {
    INNER_CIRCLE: 14,
    PROFESSIONAL: 30,
    ACQUAINTANCE: 90,
  };

  return contacts
    .filter((c) => {
      if (!c.lastInteraction && c.importedAt) return false;
      return true;
    })
    .map((c) => {
      const cadence = c.followUpDays ?? DEFAULT_CADENCE[c.tier] ?? 30;
      const dueDate = c.lastInteraction
        ? new Date(c.lastInteraction.getTime() + cadence * 24 * 60 * 60 * 1000)
        : new Date(0);
      const daysOverdue = Math.floor(
        (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      return { ...c, daysOverdue };
    })
    .filter((c) => c.daysOverdue > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

function buildGoogleCalendarLink(
  title: string,
  start: string,
  end: string,
): string {
  const fmt = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${fmt(start)}/${fmt(end)}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
