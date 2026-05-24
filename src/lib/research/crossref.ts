/**
 * Crossref client — DOI metadata. Free, no key required, polite pool
 * via mailto. Used as a fallback when a contact's recent work shows up
 * via DOI but we don't have richer OpenAlex metadata.
 */

import { withCache } from "./cache";

const CROSSREF_BASE = "https://api.crossref.org";
const USER_AGENT = `personalCRM (mailto:${process.env.CRM_CONTACT_EMAIL ?? "noreply@example.com"})`;

const DOI_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — DOI metadata is stable

export interface CrossrefWork {
  doi: string;
  title: string | null;
  authors: string[];
  publicationYear: number | null;
  containerTitle: string | null;
  citedByCount: number | null;
  abstract: string | null;
}

interface RawCrossrefMessage {
  message?: {
    DOI?: string;
    title?: string[];
    author?: Array<{ given?: string; family?: string }>;
    issued?: { "date-parts"?: number[][] };
    "container-title"?: string[];
    "is-referenced-by-count"?: number;
    abstract?: string;
  };
}

export async function getDoiMetadata(doi: string): Promise<CrossrefWork | null> {
  const normalized = doi.replace("https://doi.org/", "").trim();
  if (!normalized) return null;

  return withCache(
    { source: "crossref", kind: "doi", externalKey: normalized },
    DOI_TTL_MS,
    async () => {
      const res = await fetch(`${CROSSREF_BASE}/works/${encodeURIComponent(normalized)}`, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`Crossref ${res.status}`);
      }
      const json = (await res.json()) as RawCrossrefMessage;
      const m = json.message;
      if (!m) return null;
      return {
        doi: m.DOI ?? normalized,
        title: m.title?.[0] ?? null,
        authors: (m.author ?? [])
          .map((a) => [a.given, a.family].filter(Boolean).join(" "))
          .filter(Boolean),
        publicationYear: m.issued?.["date-parts"]?.[0]?.[0] ?? null,
        containerTitle: m["container-title"]?.[0] ?? null,
        citedByCount: m["is-referenced-by-count"] ?? null,
        abstract: m.abstract ? stripHtml(m.abstract) : null,
      };
    },
  );
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}
