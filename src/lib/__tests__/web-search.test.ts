import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@/test/helpers";
import { prisma } from "@/lib/prisma";

// Mock Anthropic SDK before importing the module under test. The default
// export is the Anthropic class; we replace it with a constructor function
// (not an arrow) so `new Anthropic(...)` works.
const messagesCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  function Anthropic() {
    return { messages: { create: messagesCreate } };
  }
  return { default: Anthropic };
});

const { searchContactWeb } = await import("@/lib/research/web-search");

describe("searchContactWeb", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    // @ts-expect-error — prisma is mocked via @/test/helpers; wire what we need.
    prisma.externalResearchCache = {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({} as never),
    };
    // @ts-expect-error — same for AIGenerationLog
    prisma.aIGenerationLog = {
      create: vi.fn().mockResolvedValue({} as never),
    };
    messagesCreate.mockReset();
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalKey;
    vi.clearAllMocks();
  });

  it("returns null when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await searchContactWeb({
      userId: "u1",
      contactId: "c1",
      name: "Marc Tarpenning",
      company: "Spero Ventures",
    });
    expect(result).toBeNull();
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it("parses summary + citations from a text block with cited URLs", async () => {
    messagesCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: "Recent post on Tesla's early founding story.",
          citations: [
            { url: "https://example.com/a", title: "Tesla story", cited_text: "..." },
            { url: "https://example.com/b", title: "Spero blog" },
          ],
        },
      ],
      usage: { input_tokens: 200, output_tokens: 80 },
    });

    const result = await searchContactWeb({
      userId: "u1",
      contactId: "c1",
      name: "Marc Tarpenning",
      company: "Spero Ventures",
    });

    expect(result?.summary).toContain("Tesla's early founding story");
    expect(result?.citations).toHaveLength(2);
    expect(result?.citations[0].url).toBe("https://example.com/a");
    expect(result?.emptyResult).toBe(false);
  });

  it("flags emptyResult when no citations come back", async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: "text", text: "No recent activity found." }],
      usage: { input_tokens: 50, output_tokens: 10 },
    });

    const result = await searchContactWeb({
      userId: "u1",
      contactId: "c1",
      name: "Nobody Person",
      company: null,
    });
    expect(result?.emptyResult).toBe(true);
    expect(result?.citations).toEqual([]);
  });

  it("deduplicates citation URLs across text blocks", async () => {
    messagesCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: "Part one.",
          citations: [{ url: "https://example.com/a", title: "T1" }],
        },
        {
          type: "text",
          text: "Part two.",
          citations: [
            { url: "https://example.com/a", title: "T1 dupe" },
            { url: "https://example.com/c", title: "T3" },
          ],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 40 },
    });

    const result = await searchContactWeb({
      userId: "u1",
      contactId: "c1",
      name: "X",
      company: null,
    });
    expect(result?.citations.map((c) => c.url)).toEqual([
      "https://example.com/a",
      "https://example.com/c",
    ]);
  });

  it("logs to AIGenerationLog on success", async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: "text", text: "Summary.", citations: [{ url: "u" }] }],
      usage: { input_tokens: 200, output_tokens: 80 },
    });

    await searchContactWeb({
      userId: "u1",
      contactId: "c1",
      name: "X",
      company: null,
    });

    expect(prisma.aIGenerationLog.create).toHaveBeenCalledTimes(1);
    const call = vi.mocked(prisma.aIGenerationLog.create).mock.calls[0][0];
    expect(call.data.feature).toBe("meeting_prep_web_search");
    expect(call.data.tokensIn).toBe(200);
    expect(call.data.tokensOut).toBe(80);
    expect(call.data.inputRefs).toEqual(["contact:c1"]);
  });
});
