import { describe, it, expect, vi, beforeEach } from "vitest";
import "@/test/helpers";
import { prisma } from "@/lib/prisma";
import { withCache } from "@/lib/research/cache";

describe("research cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error — prisma mock; wire the cache delegate used here.
    prisma.externalResearchCache = {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({} as never),
    };
  });

  it("deduplicates concurrent cache misses for the same key", async () => {
    const fetcher = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { ok: true };
    });

    const key = {
      source: "anthropic",
      kind: "web_search",
      externalKey: "contact-1",
    };

    const [first, second] = await Promise.all([
      withCache(key, 60_000, fetcher),
      withCache(key, 60_000, fetcher),
    ]);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(prisma.externalResearchCache.upsert).toHaveBeenCalledTimes(1);
  });

  it("clears failed in-flight misses so later attempts can retry", async () => {
    const key = {
      source: "openalex",
      kind: "author_search",
      externalKey: "person",
    };
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce(["ok"]);

    await expect(withCache(key, 60_000, fetcher)).rejects.toThrow(
      "temporary outage",
    );
    await expect(withCache(key, 60_000, fetcher)).resolves.toEqual(["ok"]);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
