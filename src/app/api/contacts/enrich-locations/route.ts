import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";

// ─── Known company HQ lookup (no API needed) ────────────────
const KNOWN_COMPANY_LOCATIONS: Record<string, { city: string; state: string; country: string; lat: number; lng: number }> = {
  "goldman sachs": { city: "New York", state: "NY", country: "US", lat: 40.7146, lng: -74.0071 },
  "morgan stanley": { city: "New York", state: "NY", country: "US", lat: 40.7614, lng: -73.9776 },
  "jp morgan": { city: "New York", state: "NY", country: "US", lat: 40.7556, lng: -73.9743 },
  "jpmorgan": { city: "New York", state: "NY", country: "US", lat: 40.7556, lng: -73.9743 },
  "blackrock": { city: "New York", state: "NY", country: "US", lat: 40.7614, lng: -73.9776 },
  "citadel": { city: "Chicago", state: "IL", country: "US", lat: 41.8827, lng: -87.6233 },
  "google": { city: "Mountain View", state: "CA", country: "US", lat: 37.4220, lng: -122.0841 },
  "alphabet": { city: "Mountain View", state: "CA", country: "US", lat: 37.4220, lng: -122.0841 },
  "meta": { city: "Menlo Park", state: "CA", country: "US", lat: 37.4530, lng: -122.1817 },
  "facebook": { city: "Menlo Park", state: "CA", country: "US", lat: 37.4530, lng: -122.1817 },
  "apple": { city: "Cupertino", state: "CA", country: "US", lat: 37.3349, lng: -122.0090 },
  "microsoft": { city: "Redmond", state: "WA", country: "US", lat: 47.6397, lng: -122.1285 },
  "amazon": { city: "Seattle", state: "WA", country: "US", lat: 47.6223, lng: -122.3364 },
  "aws": { city: "Seattle", state: "WA", country: "US", lat: 47.6223, lng: -122.3364 },
  "netflix": { city: "Los Gatos", state: "CA", country: "US", lat: 37.2502, lng: -121.9526 },
  "tesla": { city: "Austin", state: "TX", country: "US", lat: 30.2234, lng: -97.6191 },
  "spacex": { city: "Hawthorne", state: "CA", country: "US", lat: 33.9207, lng: -118.3280 },
  "stripe": { city: "San Francisco", state: "CA", country: "US", lat: 37.7905, lng: -122.3925 },
  "airbnb": { city: "San Francisco", state: "CA", country: "US", lat: 37.7717, lng: -122.4053 },
  "uber": { city: "San Francisco", state: "CA", country: "US", lat: 37.7749, lng: -122.4194 },
  "lyft": { city: "San Francisco", state: "CA", country: "US", lat: 37.7749, lng: -122.4194 },
  "salesforce": { city: "San Francisco", state: "CA", country: "US", lat: 37.7897, lng: -122.3969 },
  "twitter": { city: "San Francisco", state: "CA", country: "US", lat: 37.7749, lng: -122.4194 },
  "x corp": { city: "San Francisco", state: "CA", country: "US", lat: 37.7749, lng: -122.4194 },
  "nvidia": { city: "Santa Clara", state: "CA", country: "US", lat: 37.3707, lng: -121.9632 },
  "intel": { city: "Santa Clara", state: "CA", country: "US", lat: 37.3875, lng: -121.9636 },
  "openai": { city: "San Francisco", state: "CA", country: "US", lat: 37.7955, lng: -122.3937 },
  "anthropic": { city: "San Francisco", state: "CA", country: "US", lat: 37.7849, lng: -122.4000 },
  "mckinsey": { city: "New York", state: "NY", country: "US", lat: 40.7580, lng: -73.9855 },
  "bain": { city: "Boston", state: "MA", country: "US", lat: 42.3601, lng: -71.0589 },
  "bcg": { city: "Boston", state: "MA", country: "US", lat: 42.3601, lng: -71.0589 },
  "deloitte": { city: "New York", state: "NY", country: "US", lat: 40.7560, lng: -73.9869 },
  "stanford": { city: "Stanford", state: "CA", country: "US", lat: 37.4275, lng: -122.1697 },
  "stanford university": { city: "Stanford", state: "CA", country: "US", lat: 37.4275, lng: -122.1697 },
};

const MAX_CONTACTS_PER_RUN = 120;
const MAX_CITY_GEOCODES_PER_RUN = 10;
const MAX_AI_COMPANIES_PER_RUN = 25;

interface LocationEnrichmentResult {
  enriched: number;
  total: number;
  processed: number;
  remaining: number;
  geocodeCalls: number;
  aiCompaniesConsidered: number;
  capped: boolean;
}

const inFlightEnrichment = new Map<string, Promise<LocationEnrichmentResult>>();

// ─── Nominatim geocoding (free, 1 req/sec) ──────────────────
async function geocodeCity(city: string, country?: string): Promise<{ lat: number; lng: number } | null> {
  const query = country ? `${city}, ${country}` : city;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "PersonalCRM/1.0" },
    });
    if (!res.ok) return null;

    const results = await res.json();
    if (results.length === 0) return null;

    return {
      lat: parseFloat(results[0].lat),
      lng: parseFloat(results[0].lon),
    };
  } catch {
    return null;
  }
}

// ─── Rate-limited geocoding ─────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const existing = inFlightEnrichment.get(userId);
    if (existing) {
      const result = await existing;
      return NextResponse.json({ ...result, cached: true });
    }

    const run = runLocationEnrichment(userId);
    inFlightEnrichment.set(userId, run);
    try {
      const result = await run;
      return NextResponse.json(result);
    } finally {
      if (inFlightEnrichment.get(userId) === run) {
        inFlightEnrichment.delete(userId);
      }
    }
  } catch (error) {
    console.error("[POST /api/contacts/enrich-locations]", error);
    return NextResponse.json(
      { error: "Failed to enrich locations" },
      { status: 500 },
    );
  }
}

async function runLocationEnrichment(userId: string): Promise<LocationEnrichmentResult> {
  const totalMissing = await prisma.contact.count({
    where: {
      userId,
      latitude: null,
    },
  });

  if (totalMissing === 0) {
    return {
      enriched: 0,
      total: 0,
      processed: 0,
      remaining: 0,
      geocodeCalls: 0,
      aiCompaniesConsidered: 0,
      capped: false,
    };
  }

  // Process a bounded slice per request. Location enrichment can involve
  // 1 req/sec geocoding, so this must stay incremental for serverless.
  const contacts = await prisma.contact.findMany({
    where: {
      userId,
      latitude: null,
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_CONTACTS_PER_RUN,
    select: {
      id: true,
      company: true,
      city: true,
      state: true,
      country: true,
    },
  });

  let enriched = 0;
  let geocodeCalls = 0;
  let aiCompaniesConsidered = 0;
  const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

  async function geocodeOnce(
    city: string,
    country?: string | null,
  ): Promise<{ lat: number; lng: number } | null> {
    const key = `${city.toLowerCase().trim()}|${country?.toLowerCase().trim() ?? ""}`;
    if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;
    if (geocodeCalls >= MAX_CITY_GEOCODES_PER_RUN) return null;

    const coords = await geocodeCity(city, country ?? undefined);
    geocodeCache.set(key, coords);
    geocodeCalls++;
    await sleep(1100); // Nominatim rate limit.
    return coords;
  }

  // ─── Layer 1: Contacts that already have city info but no lat/lng
  const withCity = contacts.filter((c) => c.city);
  for (const c of withCity) {
    const coords = await geocodeOnce(c.city!, c.country);
    if (coords) {
      await prisma.contact.update({
        where: { id: c.id },
        data: { latitude: coords.lat, longitude: coords.lng },
      });
      enriched++;
    }
  }

  // ─── Layer 2: Known company lookup
  const remaining = contacts.filter((c) => !c.city && c.company);
  for (const c of remaining) {
    const key = c.company!.toLowerCase().trim();
    const match = KNOWN_COMPANY_LOCATIONS[key];
    if (match) {
      await prisma.contact.update({
        where: { id: c.id },
        data: {
          city: match.city,
          state: match.state,
          country: match.country,
          latitude: match.lat,
          longitude: match.lng,
        },
      });
      enriched++;
    }
  }

  // ─── Layer 3: AI inference for remaining companies
  const stillMissing = remaining.filter((c) => {
    const key = c.company!.toLowerCase().trim();
    return !KNOWN_COMPANY_LOCATIONS[key];
  });

  if (
    stillMissing.length > 0 &&
    geocodeCalls < MAX_CITY_GEOCODES_PER_RUN &&
    process.env.ANTHROPIC_API_KEY
  ) {
    const batch = stillMissing.slice(0, MAX_AI_COMPANIES_PER_RUN);
    const companyNames = [...new Set(batch.map((c) => c.company!))];
    aiCompaniesConsidered = companyNames.length;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system: `You map company names to their most likely headquarters city. Return ONLY valid JSON — an array of objects with "company", "city", and "country" fields. If unsure, omit that company. No markdown.`,
      messages: [
        {
          role: "user",
          content: `Map these companies to their HQ cities:\n${companyNames.map((n) => `- ${n}`).join("\n")}`,
        },
      ],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";

    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const results = JSON.parse(jsonMatch[0]) as Array<{
          company: string;
          city: string;
          country?: string;
        }>;

        const cityMap = new Map<string, { city: string; country?: string }>();
        for (const r of results) {
          cityMap.set(r.company.toLowerCase().trim(), { city: r.city, country: r.country });
        }

        for (const c of batch) {
          const match = cityMap.get(c.company!.toLowerCase().trim());
          if (!match) continue;

          const coords = await geocodeOnce(match.city, match.country);
          if (coords) {
            await prisma.contact.update({
              where: { id: c.id },
              data: {
                city: match.city,
                country: match.country ?? null,
                latitude: coords.lat,
                longitude: coords.lng,
              },
            });
            enriched++;
          }
        }
      }
    } catch {
      // AI response parse failure — skip
    }
  }

  const remainingAfterRun = Math.max(totalMissing - enriched, 0);

  return {
    enriched,
    total: totalMissing,
    processed: contacts.length,
    remaining: remainingAfterRun,
    geocodeCalls,
    aiCompaniesConsidered,
    capped:
      totalMissing > contacts.length ||
      geocodeCalls >= MAX_CITY_GEOCODES_PER_RUN ||
      stillMissing.length > MAX_AI_COMPANIES_PER_RUN,
  };
}
