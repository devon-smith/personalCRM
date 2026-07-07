/**
 * Deterministic contact-location search (M0.x.19).
 *
 * Powers the `find_contacts_by_location` tool in the network-query
 * orchestrator. Unlike semantic search, this hits the structured
 * Contact.city / state / country columns directly, so "who's in
 * England" is answered from data, not from embedding proximity.
 *
 * The headline feature is CONFIDENCE TIERING for sub-national regions.
 * England/Scotland/Wales/Northern Ireland are sub-nations of the UK,
 * but most contact records only carry `country = "United Kingdom"` with
 * no region. Asking "who's in England" therefore splits into:
 *   - confirmed:      state says England, or the city is an English
 *                     city (and the country doesn't contradict)
 *   - region_unknown: country is UK-ish but the sub-nation can't be
 *                     determined — could be Scotland/Wales/NI
 * and EXCLUDES records that positively pin a sibling region (Glasgow,
 * Cardiff, Belfast) or a foreign country (London, Ontario).
 *
 * The matching logic is a pure function (evaluateLocationMatch) so it
 * is unit-testable without a database; the DB layer only does a coarse
 * candidate fetch.
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export type LocationConfidence = "confirmed" | "region_unknown";

export interface LocationHit {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  tier: string;
  city: string | null;
  state: string | null;
  country: string | null;
  confidence: LocationConfidence;
  matchedOn: "city" | "state" | "country";
}

interface LocationRow {
  city: string | null;
  state: string | null;
  country: string | null;
}

// ─── Sub-national region configs ───────────────────────────

interface SubnationConfig {
  /** Canonical key, e.g. "england". */
  key: string;
  /** Matches the `country` column for the parent country (UK). */
  parent: RegExp;
  /** `state`/region values that CONFIRM this sub-nation. */
  confirmingRegion: RegExp;
  /** Cities that confirm this sub-nation (lowercased). */
  cities: Set<string>;
  /** `state` values that pin a SIBLING sub-nation (exclude). */
  siblingRegion: RegExp;
  /** Cities belonging to sibling sub-nations (exclude, lowercased). */
  siblingCities: Set<string>;
}

const UK_PARENT = /(united\s*kingdom|england|scotland|wales|northern\s*ireland|\buk\b|u\.k\.|great\s*britain|britain|\bgb\b)/i;

const ENGLAND_CITIES = [
  "london", "manchester", "birmingham", "leeds", "liverpool", "sheffield",
  "bristol", "nottingham", "leicester", "coventry", "newcastle upon tyne",
  "brighton", "oxford", "cambridge", "york", "bath", "reading",
  "southampton", "norwich", "exeter", "plymouth", "milton keynes",
];
const SCOTLAND_CITIES = ["edinburgh", "glasgow", "aberdeen", "dundee", "inverness", "stirling", "perth"];
const WALES_CITIES = ["cardiff", "swansea", "newport", "wrexham", "bangor"];
const NI_CITIES = ["belfast", "derry", "londonderry", "lisburn"];

const SUBNATIONS: Record<string, SubnationConfig> = {
  england: {
    key: "england",
    parent: UK_PARENT,
    confirmingRegion:
      /(england|greater\s*london|oxfordshire|cambridgeshire|surrey|kent|essex|west\s*midlands|greater\s*manchester|merseyside|west\s*yorkshire|south\s*yorkshire|hampshire|berkshire|devon|somerset|lancashire|cheshire|hertfordshire)/i,
    cities: new Set(ENGLAND_CITIES),
    siblingRegion: /(scotland|wales|northern\s*ireland)/i,
    siblingCities: new Set([...SCOTLAND_CITIES, ...WALES_CITIES, ...NI_CITIES]),
  },
  scotland: {
    key: "scotland",
    parent: UK_PARENT,
    confirmingRegion: /(scotland|glasgow\s*city|edinburgh|lothian|lanarkshire|aberdeenshire|fife|highland)/i,
    cities: new Set(SCOTLAND_CITIES),
    siblingRegion: /(england|wales|northern\s*ireland)/i,
    siblingCities: new Set([...ENGLAND_CITIES, ...WALES_CITIES, ...NI_CITIES]),
  },
  wales: {
    key: "wales",
    parent: UK_PARENT,
    confirmingRegion: /(wales|cardiff|glamorgan|gwynedd|powys)/i,
    cities: new Set(WALES_CITIES),
    siblingRegion: /(england|scotland|northern\s*ireland)/i,
    siblingCities: new Set([...ENGLAND_CITIES, ...SCOTLAND_CITIES, ...NI_CITIES]),
  },
  "northern ireland": {
    key: "northern ireland",
    parent: UK_PARENT,
    confirmingRegion: /(northern\s*ireland|antrim|down|armagh|tyrone|fermanagh|londonderry)/i,
    cities: new Set(NI_CITIES),
    siblingRegion: /(england|scotland|wales)/i,
    siblingCities: new Set([...ENGLAND_CITIES, ...SCOTLAND_CITIES, ...WALES_CITIES]),
  },
};

/**
 * Foreign first-level subdivisions (US states, Canadian provinces,
 * Australian states). When a contact's `state` matches one of these,
 * they are NOT in a UK sub-nation, full stop — exclude before any
 * confirming/region logic runs. This closes two real false positives
 * found against live data (M0.x.19.1):
 *   - "New Hampshire" (US) was substring-matching the English county
 *     "hampshire" in a confirming-region regex.
 *   - Cambridge / Massachusetts contacts with a NULL country slipped
 *     through the English-city branch (which permits null country for
 *     legit UK rows like "London" with no country recorded).
 * Anchored with \b and the full multi-word names so "New Hampshire"
 * matches but the UK county "Hampshire" does not.
 */
const FOREIGN_SUBDIVISION =
  /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new\s*hampshire|new\s*jersey|new\s*mexico|new\s*york|north\s*carolina|north\s*dakota|ohio|oklahoma|oregon|pennsylvania|rhode\s*island|south\s*carolina|south\s*dakota|tennessee|texas|utah|vermont|virginia|washington|west\s*virginia|wisconsin|wyoming|ontario|quebec|british\s*columbia|alberta|manitoba|saskatchewan|nova\s*scotia|new\s*brunswick|newfoundland|prince\s*edward\s*island|new\s*south\s*wales|queensland|tasmania)\b/i;

// ─── Country aliases for the generic path ──────────────────

const COUNTRY_ALIASES: Record<string, RegExp> = {
  "united kingdom": UK_PARENT,
  uk: UK_PARENT,
  "great britain": UK_PARENT,
  britain: UK_PARENT,
  gb: UK_PARENT,
  "united states": /(united\s*states|\busa\b|\bus\b|u\.s\.|america)/i,
  usa: /(united\s*states|\busa\b|\bus\b|u\.s\.|america)/i,
  us: /(united\s*states|\busa\b|\bus\b|u\.s\.|america)/i,
};

// ─── Classification ────────────────────────────────────────

export type LocationQuery =
  | { kind: "subnation"; config: SubnationConfig }
  | { kind: "country"; pattern: RegExp; label: string }
  | { kind: "generic"; normalized: string };

/** Classify a raw location string into a query strategy. Pure. */
export function classifyLocation(location: string): LocationQuery {
  const norm = location.trim().toLowerCase().replace(/\s+/g, " ");
  if (SUBNATIONS[norm]) return { kind: "subnation", config: SUBNATIONS[norm] };
  if (COUNTRY_ALIASES[norm]) {
    return { kind: "country", pattern: COUNTRY_ALIASES[norm], label: norm };
  }
  return { kind: "generic", normalized: norm };
}

/**
 * Decide whether a row matches a sub-national region query and at what
 * confidence. Returns null when the row should be excluded. Pure —
 * this is the heart of the England-vs-UK logic and the main test target.
 */
export function evaluateSubnationMatch(
  row: LocationRow,
  config: SubnationConfig,
): { confidence: LocationConfidence; matchedOn: LocationHit["matchedOn"] } | null {
  const city = (row.city ?? "").trim().toLowerCase();
  const state = (row.state ?? "").trim().toLowerCase();
  const country = (row.country ?? "").trim();

  // ── Exclusions first ──
  // A foreign first-level subdivision on the state means the contact is
  // outside the UK regardless of city/country — excludes "New Hampshire"
  // (substring-collided with the county "Hampshire") and Cambridge/
  // Massachusetts rows that had a NULL country (M0.x.19.1 fix).
  if (state && FOREIGN_SUBDIVISION.test(state)) return null;
  // A sibling region on the state (e.g. querying England, row is Scotland).
  if (state && config.siblingRegion.test(state)) return null;
  // A sibling-region city (Glasgow when querying England). This catches
  // the Jimmy-Owens case: state "Glasgow City" doesn't say "scotland",
  // but the city does.
  if (city && config.siblingCities.has(city)) return null;
  // A city that belongs to this sub-nation but the country explicitly
  // says somewhere else — London, Ontario, Canada.
  if (city && config.cities.has(city) && country && !config.parent.test(country)) {
    return null;
  }

  // ── Confirmations ──
  if (city && config.cities.has(city)) {
    return { confidence: "confirmed", matchedOn: "city" };
  }
  if (state && config.confirmingRegion.test(state)) {
    return { confidence: "confirmed", matchedOn: "state" };
  }
  // ── Region-unknown: parent country matches but sub-nation is unclear ──
  if (country && config.parent.test(country)) {
    return { confidence: "region_unknown", matchedOn: "country" };
  }
  return null;
}

/** Generic (city or country-alias) row evaluation. Pure. */
export function evaluateGenericMatch(
  row: LocationRow,
  q: LocationQuery,
): { confidence: LocationConfidence; matchedOn: LocationHit["matchedOn"] } | null {
  const city = (row.city ?? "").trim().toLowerCase();
  const state = (row.state ?? "").trim().toLowerCase();
  const country = (row.country ?? "").trim().toLowerCase();

  if (q.kind === "country") {
    if (country && q.pattern.test(country)) {
      return { confidence: "confirmed", matchedOn: "country" };
    }
    return null;
  }
  if (q.kind === "generic") {
    // Exact (case-insensitive) match on any field. Avoids substring
    // noise like "York" matching "New York".
    if (city && city === q.normalized) return { confidence: "confirmed", matchedOn: "city" };
    if (state && state === q.normalized) return { confidence: "confirmed", matchedOn: "state" };
    if (country && country === q.normalized) {
      return { confidence: "confirmed", matchedOn: "country" };
    }
    return null;
  }
  return null;
}

// ─── DB-backed search ──────────────────────────────────────

export interface LocationSearchResult {
  hits: LocationHit[];
  confirmedCount: number;
  regionUnknownCount: number;
}

/**
 * Run a deterministic location search for a user. Fetches a coarse
 * candidate set from Postgres, then classifies each row in JS via the
 * pure evaluators above.
 */
export async function searchContactsByLocation(
  userId: string,
  location: string,
  limit = 200,
): Promise<LocationSearchResult> {
  const q = classifyLocation(location);

  const candidates = await fetchCandidates(userId, q);

  const hits: LocationHit[] = [];
  for (const c of candidates) {
    const verdict =
      q.kind === "subnation"
        ? evaluateSubnationMatch(c, q.config)
        : evaluateGenericMatch(c, q);
    if (!verdict) continue;
    hits.push({
      id: c.id,
      name: c.name,
      email: c.email,
      company: c.company,
      role: c.role,
      tier: c.tier,
      city: c.city,
      state: c.state,
      country: c.country,
      confidence: verdict.confidence,
      matchedOn: verdict.matchedOn,
    });
  }

  // Confirmed first, then by tier weight, then name.
  hits.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === "confirmed" ? -1 : 1;
    const t = tierRank(b.tier) - tierRank(a.tier);
    if (t !== 0) return t;
    return a.name.localeCompare(b.name);
  });

  const confirmedCount = hits.filter((h) => h.confidence === "confirmed").length;
  return {
    hits: hits.slice(0, limit),
    confirmedCount,
    regionUnknownCount: hits.length - confirmedCount,
  };
}

interface CandidateRow extends LocationRow {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  tier: string;
}

/**
 * Coarse candidate fetch — deliberately over-inclusive; the pure
 * evaluators do the precise filtering. Scoped to the user, excludes
 * noise contacts, requires at least one location field.
 */
async function fetchCandidates(
  userId: string,
  q: LocationQuery,
): Promise<CandidateRow[]> {
  if (q.kind === "subnation") {
    const cities = [...q.config.cities, ...q.config.siblingCities];
    // Combined region pattern so we fetch both confirming and sibling
    // regions — sibling rows are pulled deliberately so the evaluator
    // can EXCLUDE them deterministically rather than silently missing
    // them.
    const regionPattern = `(${q.config.confirmingRegion.source}|${q.config.siblingRegion.source})`;
    return prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT id, name, email, company, role, tier::text AS tier, city, state, country
      FROM "Contact"
      WHERE "userId" = ${userId}
        AND "isNoise" = FALSE
        AND (
          country ~* ${q.config.parent.source}
          OR state ~* ${regionPattern}
          OR (city IS NOT NULL AND lower(city) = ANY(${cities}))
        )
    `);
  }
  if (q.kind === "country") {
    return prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT id, name, email, company, role, tier::text AS tier, city, state, country
      FROM "Contact"
      WHERE "userId" = ${userId}
        AND "isNoise" = FALSE
        AND country ~* ${q.pattern.source}
    `);
  }
  // generic
  return prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    SELECT id, name, email, company, role, tier::text AS tier, city, state, country
    FROM "Contact"
    WHERE "userId" = ${userId}
      AND "isNoise" = FALSE
      AND (
        lower(city) = ${q.normalized}
        OR lower(state) = ${q.normalized}
        OR lower(country) = ${q.normalized}
      )
  `);
}

function tierRank(tier: string): number {
  switch (tier) {
    case "INNER_CIRCLE": return 3;
    case "PROFESSIONAL": return 2;
    case "ACQUAINTANCE": return 1;
    default: return 0;
  }
}
