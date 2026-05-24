import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@/test/helpers";
import { prisma } from "@/lib/prisma";
import { searchRecentMentions, BraveSearchError } from "@/lib/research/brave-search";

describe("searchRecentMentions", () => {
  const origFetch = globalThis.fetch;
  const origKey = process.env.BRAVE_API_KEY;

  beforeEach(() => {
    process.env.BRAVE_API_KEY = "test-key";
    // @ts-expect-error — prisma mock; wire what we need.
    prisma.externalResearchCache = {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({} as never),
    };
    // @ts-expect-error — same for AIGenerationLog
    prisma.aIGenerationLog = {
      create: vi.fn().mockResolvedValue({} as never),
    };
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    process.env.BRAVE_API_KEY = origKey;
    vi.clearAllMocks();
  });

  it("returns [] when BRAVE_API_KEY is unset", async () => {
    delete process.env.BRAVE_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as never;
    const result = await searchRecentMentions("u1", "Marc Beban");
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns [] on empty query without hitting the API", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as never;
    const result = await searchRecentMentions("u1", "   ");
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parses title / url / description / age from Brave response", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "Marc Tarpenning on the founding of Tesla",
                url: "https://example.com/article",
                description: "An interview about Tesla's early days...",
                age: "3 days ago",
                page_age: "2026-05-21T00:00:00Z",
              },
              {
                title: "Second hit",
                url: "https://example.com/two",
                description: "...",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    ) as never;

    const result = await searchRecentMentions("u1", "Marc Tarpenning", "pm", 5);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Marc Tarpenning on the founding of Tesla");
    expect(result[0].url).toBe("https://example.com/article");
    expect(result[0].age).toBe("3 days ago");
    expect(result[0].publishedAt).toBe("2026-05-21T00:00:00Z");
    expect(result[1].age).toBeNull();
  });

  it("sends X-Subscription-Token + freshness + count", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit | undefined) => {
      capturedUrl = url;
      capturedHeaders = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      );
      return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
    }) as never;

    await searchRecentMentions("u1", "Sarah Chen", "pw", 3);

    expect(capturedHeaders["x-subscription-token"]).toBe("test-key");
    expect(capturedUrl).toContain("freshness=pw");
    expect(capturedUrl).toContain("count=3");
    expect(capturedUrl).toContain("q=Sarah+Chen");
  });

  it("flags 429 / 5xx as retryable in BraveSearchError", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("rate limited", { status: 429 }),
    ) as never;

    try {
      await searchRecentMentions("u1", "Test");
      throw new Error("Expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BraveSearchError);
      expect((err as BraveSearchError).status).toBe(429);
      expect((err as BraveSearchError).retryable).toBe(true);
    }
  });

  it("flags 4xx (other than 429) as non-retryable", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("bad query", { status: 400 }),
    ) as never;

    try {
      await searchRecentMentions("u1", "Test");
      throw new Error("Expected to throw");
    } catch (err) {
      expect((err as BraveSearchError).status).toBe(400);
      expect((err as BraveSearchError).retryable).toBe(false);
    }
  });

  it("logs to AIGenerationLog on success", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ web: { results: [] } }), { status: 200 }),
    ) as never;

    await searchRecentMentions("u1", "Sarah Chen");

    expect(prisma.aIGenerationLog.create).toHaveBeenCalledTimes(1);
    const call = vi.mocked(prisma.aIGenerationLog.create).mock.calls[0][0];
    expect(call.data.feature).toBe("brave_search");
    expect(call.data.model).toBe("brave-web");
  });
});
