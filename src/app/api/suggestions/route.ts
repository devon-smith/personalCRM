import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUpcomingEvents } from "@/lib/calendar";

/**
 * GET /api/suggestions
 *
 * Returns proactive reach-out suggestions:
 *   1. Calendar-aware: upcoming events with contacts you haven't talked to recently
 *   2. Relationship decay: contacts you haven't interacted with past their cadence
 *   3. Travel-based: upcoming trips with contacts in that city
 *
 * Response: { calendarSuggestions, decaySuggestions, travelSuggestions }
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const [calendarSuggestions, decaySuggestions, travelSuggestions] = await Promise.all([
      getCalendarSuggestions(userId),
      getDecaySuggestions(userId),
      getTravelSuggestions(userId),
    ]);

    return NextResponse.json({
      calendarSuggestions,
      decaySuggestions,
      travelSuggestions,
    });
  } catch (error) {
    console.error("[GET /api/suggestions]", error);
    return NextResponse.json(
      { error: "Failed to generate suggestions" },
      { status: 500 },
    );
  }
}

// ─── Calendar-aware suggestions ─────────────────────────────
// "You have a meeting with Sarah tomorrow — you haven't talked in 3 weeks"

interface CalendarSuggestion {
  type: "upcoming_meeting";
  contactId: string;
  contactName: string;
  eventTitle: string;
  eventTime: string;
  daysSinceLastInteraction: number | null;
  reason: string;
}

async function getCalendarSuggestions(userId: string): Promise<CalendarSuggestion[]> {
  let events;
  try {
    events = await getUpcomingEvents(userId, 7);
  } catch {
    // Calendar not connected — return empty
    return [];
  }

  if (events.length === 0) return [];

  // Get all contactIds from events
  const contactIds = events
    .flatMap((e) => e.attendees)
    .map((a) => a.contactId)
    .filter((id): id is string => id !== null);

  if (contactIds.length === 0) return [];

  // Fetch last interaction for these contacts
  const contacts = await prisma.contact.findMany({
    where: { id: { in: [...new Set(contactIds)] } },
    select: { id: true, name: true, lastInteraction: true },
  });
  const contactMap = new Map(contacts.map((c) => [c.id, c]));

  const suggestions: CalendarSuggestion[] = [];
  const seenContactIds = new Set<string>();
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000);

  for (const event of events) {
    for (const attendee of event.attendees) {
      if (!attendee.contactId || seenContactIds.has(attendee.contactId)) continue;
      seenContactIds.add(attendee.contactId);

      const contact = contactMap.get(attendee.contactId);
      if (!contact) continue;

      // Only suggest if haven't talked in 2+ weeks (or never)
      const lastInteraction = contact.lastInteraction;
      if (lastInteraction && lastInteraction > twoWeeksAgo) continue;

      const daysSince = lastInteraction
        ? Math.floor((Date.now() - lastInteraction.getTime()) / 86400000)
        : null;

      suggestions.push({
        type: "upcoming_meeting",
        contactId: contact.id,
        contactName: contact.name,
        eventTitle: event.title,
        eventTime: event.startTime,
        daysSinceLastInteraction: daysSince,
        reason: daysSince
          ? `Meeting "${event.title}" coming up — last talked ${daysSince} days ago`
          : `Meeting "${event.title}" coming up — no prior interactions`,
      });
    }
  }

  return suggestions.slice(0, 10);
}

// ─── Relationship decay suggestions ─────────────────────────
// "You haven't talked to James in 45 days (circle cadence: 30 days)"

interface DecaySuggestion {
  type: "relationship_decay";
  contactId: string;
  contactName: string;
  company: string | null;
  tier: string;
  circleName: string | null;
  cadenceDays: number;
  daysSinceLastInteraction: number;
  reason: string;
}

async function getDecaySuggestions(userId: string): Promise<DecaySuggestion[]> {
  // Get contacts with circle membership and cadence
  const contacts = await prisma.contact.findMany({
    where: {
      userId,
      lastInteraction: { not: null },
    },
    select: {
      id: true,
      name: true,
      company: true,
      tier: true,
      lastInteraction: true,
      followUpDays: true,
      circles: {
        select: {
          circle: {
            select: { name: true, followUpDays: true },
          },
        },
      },
    },
    orderBy: { lastInteraction: "asc" },
  });

  const now = Date.now();
  const suggestions: DecaySuggestion[] = [];

  for (const contact of contacts) {
    if (!contact.lastInteraction) continue;

    // Determine cadence: contact-specific > circle > tier default
    const circleCadence = contact.circles[0]?.circle.followUpDays ?? null;
    const circleName = contact.circles[0]?.circle.name ?? null;
    const cadenceDays = contact.followUpDays
      ?? circleCadence
      ?? tierDefaultCadence(contact.tier);

    const daysSince = Math.floor((now - contact.lastInteraction.getTime()) / 86400000);

    // Only suggest if past cadence
    if (daysSince <= cadenceDays) continue;

    suggestions.push({
      type: "relationship_decay",
      contactId: contact.id,
      contactName: contact.name,
      company: contact.company,
      tier: contact.tier,
      circleName,
      cadenceDays,
      daysSinceLastInteraction: daysSince,
      reason: `Last talked ${daysSince} days ago (cadence: ${cadenceDays} days)`,
    });
  }

  // Sort by most overdue first (days since / cadence ratio)
  suggestions.sort((a, b) => {
    const ratioA = a.daysSinceLastInteraction / a.cadenceDays;
    const ratioB = b.daysSinceLastInteraction / b.cadenceDays;
    return ratioB - ratioA;
  });

  return suggestions.slice(0, 20);
}

function tierDefaultCadence(tier: string): number {
  switch (tier) {
    case "INNER_CIRCLE": return 14;
    case "PROFESSIONAL": return 30;
    case "ACQUAINTANCE": return 90;
    default: return 60;
  }
}

// ─── Travel-based suggestions ───────────────────────────────
// "You're flying to NYC Thursday — reach out to Sarah, James, and Mike"

interface TravelSuggestion {
  type: "travel";
  city: string;
  eventTitle: string;
  eventTime: string;
  contacts: Array<{
    contactId: string;
    contactName: string;
    daysSinceLastInteraction: number | null;
  }>;
  reason: string;
}

// Keywords that indicate travel events
const TRAVEL_KEYWORDS = [
  "flight", "fly", "flying",
  "hotel", "airbnb",
  "trip", "travel",
  "visit", "visiting",
];

// City extraction patterns — matches "Flight to NYC", "Hotel in San Francisco", etc.
const CITY_PATTERNS = [
  /(?:to|in|at|→|->)\s+([A-Z][a-zA-Z\s]{2,30}?)(?:\s*[-–—,]|\s*$)/,
  /([A-Z]{3})\s*→\s*([A-Z]{3})/, // Airport codes: JFK → SFO
];

async function getTravelSuggestions(userId: string): Promise<TravelSuggestion[]> {
  let events;
  try {
    events = await getUpcomingEvents(userId, 14);
  } catch {
    return [];
  }

  const suggestions: TravelSuggestion[] = [];

  for (const event of events) {
    const title = event.title.toLowerCase();
    const isTravelEvent = TRAVEL_KEYWORDS.some((kw) => title.includes(kw));
    if (!isTravelEvent) continue;

    // Try to extract destination city
    const city = extractCity(event.title);
    if (!city) continue;

    // Find contacts in that city
    const contactsInCity = await prisma.contact.findMany({
      where: {
        userId,
        OR: [
          { city: { contains: city, mode: "insensitive" } },
          { state: { contains: city, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, lastInteraction: true },
      take: 10,
    });

    if (contactsInCity.length === 0) continue;

    const now = Date.now();
    suggestions.push({
      type: "travel",
      city,
      eventTitle: event.title,
      eventTime: event.startTime,
      contacts: contactsInCity.map((c) => ({
        contactId: c.id,
        contactName: c.name,
        daysSinceLastInteraction: c.lastInteraction
          ? Math.floor((now - c.lastInteraction.getTime()) / 86400000)
          : null,
      })),
      reason: `You're heading to ${city} — ${contactsInCity.length} contact${contactsInCity.length > 1 ? "s" : ""} nearby`,
    });
  }

  return suggestions.slice(0, 5);
}

function extractCity(title: string): string | null {
  // Try airport code pattern first (e.g., "JFK → SFO")
  const airportMatch = title.match(/([A-Z]{3})\s*[→\->]+\s*([A-Z]{3})/);
  if (airportMatch) {
    return airportCodeToCity(airportMatch[2]) ?? airportMatch[2];
  }

  // Try natural language patterns
  for (const pattern of CITY_PATTERNS) {
    const match = title.match(pattern);
    if (match) {
      const city = (match[2] ?? match[1]).trim();
      if (city.length >= 3 && city.length <= 30) return city;
    }
  }

  return null;
}

const AIRPORT_CODES: Record<string, string> = {
  JFK: "New York", LGA: "New York", EWR: "New York",
  LAX: "Los Angeles",
  SFO: "San Francisco", OAK: "San Francisco", SJC: "San Jose",
  ORD: "Chicago", MDW: "Chicago",
  ATL: "Atlanta",
  DFW: "Dallas", DAL: "Dallas",
  DEN: "Denver",
  SEA: "Seattle",
  MIA: "Miami", FLL: "Miami",
  BOS: "Boston",
  PHX: "Phoenix",
  IAH: "Houston", HOU: "Houston",
  MSP: "Minneapolis",
  DTW: "Detroit",
  PHL: "Philadelphia",
  CLT: "Charlotte",
  SAN: "San Diego",
  TPA: "Tampa",
  PDX: "Portland",
  AUS: "Austin",
  BNA: "Nashville",
  STL: "St. Louis",
  DCA: "Washington DC", IAD: "Washington DC",
  LHR: "London", LGW: "London",
  CDG: "Paris", ORY: "Paris",
  NRT: "Tokyo", HND: "Tokyo",
};

function airportCodeToCity(code: string): string | null {
  return AIRPORT_CODES[code.toUpperCase()] ?? null;
}
