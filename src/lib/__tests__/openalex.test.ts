import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@/test/helpers";
import { prisma } from "@/lib/prisma";
import { searchAuthors, getAuthorWithRecentWorks } from "@/lib/research/openalex";

describe("OpenAlex client — parsing + cache lifecycle", () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    // @ts-expect-error — prisma mock; wire what we need.
    prisma.externalResearchCache = {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({} as never),
    };
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.clearAllMocks();
  });

  it("searchAuthors parses display_name, works_count, h_index, institution", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              id: "https://openalex.org/A111",
              display_name: "Jennifer Aaker",
              works_count: 142,
              cited_by_count: 18420,
              summary_stats: { h_index: 52 },
              last_known_institutions: [
                { display_name: "Stanford University", country_code: "US" },
              ],
              affiliations: [
                { institution: { display_name: "Stanford University" } },
                { institution: { display_name: "UC Berkeley" } },
              ],
              orcid: "https://orcid.org/0000-0001-2345-6789",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as never;

    const result = await searchAuthors("Jennifer Aaker");
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe("Jennifer Aaker");
    expect(result[0].worksCount).toBe(142);
    expect(result[0].hIndex).toBe(52);
    expect(result[0].lastKnownInstitution?.displayName).toBe("Stanford University");
    expect(result[0].affiliations).toContain("UC Berkeley");
    expect(result[0].orcid).toBe("https://orcid.org/0000-0001-2345-6789");
  });

  it("searchAuthors returns empty array on empty query without hitting the API", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as never;

    const result = await searchAuthors("   ");
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("searchAuthors writes through the cache with TTL", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    ) as never;

    await searchAuthors("Marc Andreessen");

    expect(prisma.externalResearchCache.upsert).toHaveBeenCalledTimes(1);
    const call = vi.mocked(prisma.externalResearchCache.upsert).mock.calls[0][0];
    expect(call.create.source).toBe("openalex");
    expect(call.create.kind).toBe("author_search");
    expect(call.create.externalKey).toBe("marc andreessen");
    expect(call.create.expiresAt).toBeInstanceOf(Date);
  });

  it("getAuthorWithRecentWorks parses works alongside the author", async () => {
    let callIndex = 0;
    globalThis.fetch = vi.fn(async () => {
      callIndex++;
      if (callIndex === 1) {
        // Author endpoint
        return new Response(
          JSON.stringify({
            id: "https://openalex.org/A222",
            display_name: "Marc Tarpenning",
            works_count: 3,
            cited_by_count: 1000,
            last_known_institution: { display_name: "Spero Ventures" },
          }),
          { status: 200 },
        );
      }
      // Works endpoint
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "https://openalex.org/W1",
              title: "Recent paper",
              publication_year: 2025,
              publication_date: "2025-11-12",
              cited_by_count: 12,
              type: "article",
              doi: "https://doi.org/10.1000/xyz",
              primary_location: { source: { display_name: "Nature" } },
            },
          ],
        }),
        { status: 200 },
      );
    }) as never;

    const result = await getAuthorWithRecentWorks("https://openalex.org/A222");
    expect(result).not.toBeNull();
    expect(result!.author.displayName).toBe("Marc Tarpenning");
    expect(result!.works).toHaveLength(1);
    expect(result!.works[0].title).toBe("Recent paper");
    expect(result!.works[0].venue).toBe("Nature");
    expect(result!.works[0].url).toBe("https://doi.org/10.1000/xyz");
  });

  it("getAuthorWithRecentWorks strips the openalex.org URL prefix from the ID", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "x", display_name: "" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as never;

    await getAuthorWithRecentWorks("https://openalex.org/A333");

    // First call hits /authors/A333 (no URL prefix).
    const firstCall = fetchMock.mock.calls[0][0] as string;
    expect(firstCall).toContain("/authors/A333");
    expect(firstCall).not.toContain("https://openalex.org/A333");
  });
});
