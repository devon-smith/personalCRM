/**
 * OpenAlex client — free, no key required. Identifying yourself in
 * User-Agent puts you in their "polite pool" with better SLAs.
 *
 * Two operations cover most of the meeting-prep need:
 *  - searchAuthors(name) → list of candidate authors to disambiguate
 *  - getAuthorWithRecentWorks(id) → author profile + recent papers
 *
 * Both are cached. Search results cache short (24h) because new authors
 * appear; author profiles cache longer (7d) because affiliations
 * change slowly.
 */

import { withCache } from "./cache";

const OPENALEX_BASE = "https://api.openalex.org";
const USER_AGENT = `personalCRM (mailto:${process.env.CRM_CONTACT_EMAIL ?? "noreply@example.com"})`;

const SEARCH_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
const AUTHOR_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface OpenAlexAuthor {
  id: string; // "https://openalex.org/A1234..."
  displayName: string;
  worksCount: number;
  citedByCount: number;
  hIndex: number | null;
  lastKnownInstitution: {
    displayName: string;
    countryCode?: string;
  } | null;
  affiliations: string[];
  orcid: string | null;
}

export interface OpenAlexWork {
  id: string;
  title: string;
  publicationYear: number | null;
  publicationDate: string | null;
  citedByCount: number;
  type: string | null;
  doi: string | null;
  venue: string | null;
  url: string | null;
}

interface RawAuthorListResponse {
  results?: Array<RawAuthor>;
}

interface RawAuthor {
  id?: string;
  display_name?: string;
  works_count?: number;
  cited_by_count?: number;
  summary_stats?: { h_index?: number };
  last_known_institution?: { display_name?: string; country_code?: string };
  last_known_institutions?: Array<{ display_name?: string; country_code?: string }>;
  affiliations?: Array<{ institution?: { display_name?: string } }>;
  orcid?: string;
}

interface RawWorkListResponse {
  results?: Array<RawWork>;
}

interface RawWork {
  id?: string;
  title?: string;
  publication_year?: number;
  publication_date?: string;
  cited_by_count?: number;
  type?: string;
  doi?: string;
  primary_location?: { source?: { display_name?: string } };
}

async function openAlexFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${OPENALEX_BASE}${path}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAlex ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * Search OpenAlex for authors matching a name. Returns up to 5 candidates
 * ranked by their default relevance (which factors in works/citations).
 */
export async function searchAuthors(name: string): Promise<OpenAlexAuthor[]> {
  const key = name.trim().toLowerCase();
  if (!key) return [];

  return withCache(
    { source: "openalex", kind: "author_search", externalKey: key },
    SEARCH_TTL_MS,
    async () => {
      const data = await openAlexFetch<RawAuthorListResponse>(
        `/authors?search=${encodeURIComponent(name)}&per-page=5`,
      );
      return (data.results ?? []).slice(0, 5).map(parseAuthor);
    },
  );
}

/**
 * Fetch a single author and their N most recent works.
 */
export async function getAuthorWithRecentWorks(
  authorId: string,
  worksLimit: number = 5,
): Promise<{ author: OpenAlexAuthor; works: OpenAlexWork[] } | null> {
  const id = authorId.replace("https://openalex.org/", "");

  return withCache(
    { source: "openalex", kind: "author_with_works", externalKey: id },
    AUTHOR_TTL_MS,
    async () => {
      const [author, works] = await Promise.all([
        openAlexFetch<RawAuthor>(`/authors/${id}`),
        openAlexFetch<RawWorkListResponse>(
          `/works?filter=author.id:${id}&sort=publication_date:desc&per-page=${worksLimit}`,
        ),
      ]);
      return {
        author: parseAuthor(author),
        works: (works.results ?? []).slice(0, worksLimit).map(parseWork),
      };
    },
  );
}

function parseAuthor(raw: RawAuthor): OpenAlexAuthor {
  const lastInstFromArray = raw.last_known_institutions?.[0];
  const lastInst = raw.last_known_institution ?? lastInstFromArray ?? null;

  const affiliations = (raw.affiliations ?? [])
    .map((a) => a.institution?.display_name)
    .filter((v): v is string => !!v);

  return {
    id: raw.id ?? "",
    displayName: raw.display_name ?? "",
    worksCount: raw.works_count ?? 0,
    citedByCount: raw.cited_by_count ?? 0,
    hIndex: raw.summary_stats?.h_index ?? null,
    lastKnownInstitution: lastInst?.display_name
      ? {
          displayName: lastInst.display_name,
          countryCode: lastInst.country_code,
        }
      : null,
    affiliations: Array.from(new Set(affiliations)),
    orcid: raw.orcid ?? null,
  };
}

function parseWork(raw: RawWork): OpenAlexWork {
  return {
    id: raw.id ?? "",
    title: raw.title ?? "(untitled)",
    publicationYear: raw.publication_year ?? null,
    publicationDate: raw.publication_date ?? null,
    citedByCount: raw.cited_by_count ?? 0,
    type: raw.type ?? null,
    doi: raw.doi ?? null,
    venue: raw.primary_location?.source?.display_name ?? null,
    url: raw.doi ? `https://doi.org/${raw.doi.replace("https://doi.org/", "")}` : null,
  };
}
