/**
 * Brave Search client. Used by the nightly signal-detection worker
 * (Milestone 5.2) to scan recent news mentions of high-tier contacts.
 *
 * API: https://api.search.brave.com/res/v1/web/search
 * Auth: X-Subscription-Token header
 * Free tier: ~2k queries/month — comfortably above the ~30/day we'd
 * use for INNER_CIRCLE-only weekly scans.
 *
 * https://brave.com/search/api/
 */

import { withCache } from "./cache";
import { logAIGeneration } from "@/lib/ai-generation-log";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

/** Cache window — news churns quickly, but re-running same query within
 *  a day is wasteful. 12-hour TTL is the sweet spot. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export interface BraveSearchHit {
  title: string;
  url: string;
  description: string | null;
  /** Free-text age string Brave returns ("2 days ago", "1 week ago"). */
  age: string | null;
  /** ISO publish date when Brave was able to parse one. */
  publishedAt: string | null;
}

export type BraveFreshness = "pd" | "pw" | "pm" | "py";

interface RawBraveResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      age?: string;
      page_age?: string;
    }>;
  };
}

export class BraveSearchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "BraveSearchError";
  }
}

/**
 * Search Brave for recent mentions of a contact. Cached for 12h by
 * (query, freshness). Returns [] when BRAVE_API_KEY is unset — caller
 * decides whether that's expected (dev env) or surface-worthy.
 */
export async function searchRecentMentions(
  userId: string,
  query: string,
  freshness: BraveFreshness = "pm",
  limit: number = 5,
): Promise<BraveSearchHit[]> {
  if (!process.env.BRAVE_API_KEY) return [];
  const q = query.trim();
  if (!q) return [];

  return withCache(
    {
      source: "brave",
      kind: "web_search",
      externalKey: `${freshness}|${q.toLowerCase()}`,
    },
    CACHE_TTL_MS,
    async () => runSearch(userId, q, freshness, limit),
  );
}

async function runSearch(
  userId: string,
  q: string,
  freshness: BraveFreshness,
  limit: number,
): Promise<BraveSearchHit[]> {
  const startedAt = Date.now();
  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set("q", q);
  url.searchParams.set("count", String(Math.min(20, Math.max(1, limit))));
  url.searchParams.set("freshness", freshness);
  url.searchParams.set("safesearch", "moderate");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": process.env.BRAVE_API_KEY!,
      },
    });
  } catch (err) {
    await logAIGeneration({
      userId,
      feature: "brave_search",
      model: "brave-web",
      inputRefs: [q],
      error: err instanceof Error ? err.message : "network error",
    });
    throw new BraveSearchError(
      err instanceof Error ? err.message : "network error",
      undefined,
      true,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    await logAIGeneration({
      userId,
      feature: "brave_search",
      model: "brave-web",
      inputRefs: [q],
      error: `${res.status}: ${body.slice(0, 200)}`,
    });
    throw new BraveSearchError(
      `Brave ${res.status}: ${body.slice(0, 200)}`,
      res.status,
      retryable,
    );
  }

  const data = (await res.json()) as RawBraveResponse;
  const hits = (data.web?.results ?? []).slice(0, limit).map(parseHit);

  await logAIGeneration({
    userId,
    feature: "brave_search",
    model: "brave-web",
    inputRefs: [q],
    latencyMs: Date.now() - startedAt,
  });

  return hits;
}

function parseHit(raw: {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  page_age?: string;
}): BraveSearchHit {
  return {
    title: raw.title ?? "(untitled)",
    url: raw.url ?? "",
    description: raw.description ?? null,
    age: raw.age ?? null,
    publishedAt: raw.page_age ?? null,
  };
}
