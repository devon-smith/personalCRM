import { describe, it, expect, vi, beforeEach } from "vitest";
import { selectWithFallback } from "@/lib/voice/few-shot-retrieval";

describe("selectWithFallback", () => {
  it("returns just primary when primary has enough rows", () => {
    const primary = [{ emailMessageId: "a" }, { emailMessageId: "b" }];
    const fallback = [{ emailMessageId: "c" }];
    const out = selectWithFallback(primary, fallback, 2);
    expect(out).toEqual([
      { emailMessageId: "a", matchKind: "primary" },
      { emailMessageId: "b", matchKind: "primary" },
    ]);
  });

  it("pads with fallback when primary is short", () => {
    const primary = [{ emailMessageId: "a" }];
    const fallback = [{ emailMessageId: "b" }, { emailMessageId: "c" }];
    const out = selectWithFallback(primary, fallback, 3);
    expect(out).toEqual([
      { emailMessageId: "a", matchKind: "primary" },
      { emailMessageId: "b", matchKind: "fallback" },
      { emailMessageId: "c", matchKind: "fallback" },
    ]);
  });

  it("dedupes — fallback row already in primary is skipped", () => {
    const primary = [{ emailMessageId: "a" }];
    const fallback = [
      { emailMessageId: "a" }, // dup
      { emailMessageId: "b" },
    ];
    const out = selectWithFallback(primary, fallback, 2);
    expect(out.map((r) => r.emailMessageId)).toEqual(["a", "b"]);
  });

  it("returns fewer than K if both lists are exhausted", () => {
    const primary = [{ emailMessageId: "a" }];
    const fallback = [{ emailMessageId: "b" }];
    const out = selectWithFallback(primary, fallback, 5);
    expect(out).toHaveLength(2);
  });

  it("handles empty primary", () => {
    const primary: { emailMessageId: string }[] = [];
    const fallback = [{ emailMessageId: "a" }, { emailMessageId: "b" }];
    const out = selectWithFallback(primary, fallback, 2);
    expect(out.every((r) => r.matchKind === "fallback")).toBe(true);
  });

  it("preserves all properties on tagged rows", () => {
    const primary = [{ emailMessageId: "a", similarity: 0.9, foo: 1 }];
    const out = selectWithFallback(primary, [], 1);
    expect(out[0]).toEqual({
      emailMessageId: "a",
      similarity: 0.9,
      foo: 1,
      matchKind: "primary",
    });
  });
});

// ─── Integration: getVoiceExamples with mocked deps ────────

vi.mock("@/lib/search/embeddings", () => ({
  embedBatch: vi.fn(),
  formatVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

vi.mock("@/lib/voice/relationship-classifier", async (importOriginal) => {
  const orig = await importOriginal<
    typeof import("@/lib/voice/relationship-classifier")
  >();
  return {
    ...orig,
    classifyRecipient: vi.fn(),
  };
});

import { getVoiceExamples } from "@/lib/voice/few-shot-retrieval";
import { embedBatch } from "@/lib/search/embeddings";
import { classifyRecipient } from "@/lib/voice/relationship-classifier";

interface MockPrisma {
  $queryRaw: ReturnType<typeof vi.fn>;
  emailMessage: { findMany: ReturnType<typeof vi.fn> };
  voiceProfile: { findUnique: ReturnType<typeof vi.fn> };
}

function mockPrisma(): MockPrisma {
  return {
    $queryRaw: vi.fn(),
    emailMessage: { findMany: vi.fn() },
    voiceProfile: { findUnique: vi.fn() },
  };
}

const ORIGINAL_VOYAGE_KEY = process.env.VOYAGE_API_KEY;

describe("getVoiceExamples", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VOYAGE_API_KEY = "test-key";
    (embedBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3]],
      tokens: 10,
    });
    (classifyRecipient as ReturnType<typeof vi.fn>).mockResolvedValue(
      "former_student",
    );
  });

  it("throws when VOYAGE_API_KEY is not set", async () => {
    delete process.env.VOYAGE_API_KEY;
    const prisma = mockPrisma();
    await expect(
      getVoiceExamples({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma: prisma as any,
        userId: "u1",
        recipientEmail: "marc@example.com",
        draftIntent: "following up on the deck",
      }),
    ).rejects.toThrow(/VOYAGE_API_KEY/);
    process.env.VOYAGE_API_KEY = ORIGINAL_VOYAGE_KEY ?? "test-key";
  });

  it("returns primary-only results when type-matched bucket is full", async () => {
    const prisma = mockPrisma();
    // First $queryRaw call: primary (k=2 results, enough). No fallback call.
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        emailMessageId: "e1",
        toEmail: "marc@example.com",
        sentAt: new Date("2026-05-20"),
        relationshipType: "former_student",
        openingType: "first_name",
        closingType: "warmly",
        wordCount: 60,
        avgSentenceLen: 14,
        similarity: 0.87,
        recipientName: "Marc Beban",
      },
      {
        emailMessageId: "e2",
        toEmail: "sarah@example.com",
        sentAt: new Date("2026-05-15"),
        relationshipType: "former_student",
        openingType: "first_name",
        closingType: "warmly",
        wordCount: 45,
        avgSentenceLen: 12,
        similarity: 0.82,
        recipientName: "Sarah Chen",
      },
    ]);
    prisma.emailMessage.findMany.mockResolvedValueOnce([
      { id: "e1", fullBody: "Marc,\n\nThanks for sending.\n\nWarmly,\nJ" },
      { id: "e2", fullBody: "Sarah,\n\nQuick note.\n\nWarmly,\nJ" },
    ]);
    prisma.voiceProfile.findUnique.mockResolvedValueOnce({
      signatureLines: [],
    });

    const out = await getVoiceExamples({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      userId: "u1",
      recipientEmail: "marc@example.com",
      draftIntent: "following up on the deck",
      k: 2,
    });

    expect(out).toHaveLength(2);
    expect(out.every((r) => r.matchKind === "primary")).toBe(true);
    expect(out[0].body).toContain("Thanks for sending");
    expect(out[0].recipientName).toBe("Marc Beban");
    // Only the primary query ran (one $queryRaw call, no fallback).
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("pads with fallback when primary returns fewer than K", async () => {
    const prisma = mockPrisma();
    // Primary call returns only 1 result (< k=3).
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          emailMessageId: "e1",
          toEmail: "marc@example.com",
          sentAt: new Date(),
          relationshipType: "former_student",
          openingType: "first_name",
          closingType: "warmly",
          wordCount: 60,
          avgSentenceLen: 14,
          similarity: 0.9,
          recipientName: "Marc",
        },
      ])
      // Fallback call returns 2 more (other relationship types).
      .mockResolvedValueOnce([
        {
          emailMessageId: "e2",
          toEmail: "peer@example.com",
          sentAt: new Date(),
          relationshipType: "peer_faculty",
          openingType: "first_name",
          closingType: "best",
          wordCount: 80,
          avgSentenceLen: 16,
          similarity: 0.75,
          recipientName: "Peer",
        },
        {
          emailMessageId: "e3",
          toEmail: "exec@example.com",
          sentAt: new Date(),
          relationshipType: "industry_exec",
          openingType: "first_name",
          closingType: "thanks",
          wordCount: 50,
          avgSentenceLen: 11,
          similarity: 0.70,
          recipientName: "Exec",
        },
      ]);
    prisma.emailMessage.findMany.mockResolvedValueOnce([
      { id: "e1", fullBody: "Marc body" },
      { id: "e2", fullBody: "Peer body content here for length" },
      { id: "e3", fullBody: "Exec body content here for length" },
    ]);
    prisma.voiceProfile.findUnique.mockResolvedValueOnce({
      signatureLines: [],
    });

    const out = await getVoiceExamples({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      userId: "u1",
      recipientEmail: "marc@example.com",
      draftIntent: "checking in",
      k: 3,
    });

    expect(out).toHaveLength(3);
    expect(out[0].matchKind).toBe("primary");
    expect(out[1].matchKind).toBe("fallback");
    expect(out[2].matchKind).toBe("fallback");
    // Two $queryRaw calls — primary + fallback.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("returns empty when the corpus has no embedded examples", async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // primary empty
      .mockResolvedValueOnce([]); // fallback empty
    prisma.emailMessage.findMany.mockResolvedValueOnce([]);
    prisma.voiceProfile.findUnique.mockResolvedValueOnce({
      signatureLines: [],
    });

    const out = await getVoiceExamples({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      userId: "u1",
      recipientEmail: "anyone@example.com",
      draftIntent: "anything",
    });
    expect(out).toEqual([]);
  });

  it("applies user signatureLines when hydrating bodies", async () => {
    const prisma = mockPrisma();
    const sigName = "Jennifer Aaker | General Atlantic Professor | Stanford GSB";
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        emailMessageId: "e1",
        toEmail: "marc@example.com",
        sentAt: new Date(),
        relationshipType: "former_student",
        openingType: "first_name",
        closingType: "none",
        wordCount: 12,
        avgSentenceLen: 6,
        similarity: 0.88,
        recipientName: "Marc",
      },
    ]);
    prisma.emailMessage.findMany.mockResolvedValueOnce([
      {
        id: "e1",
        fullBody: `Marc,\n\nThanks for sending.\n\n${sigName}\nWebsite\nlinkedin`,
      },
    ]);
    prisma.voiceProfile.findUnique.mockResolvedValueOnce({
      signatureLines: [sigName],
    });

    const out = await getVoiceExamples({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      userId: "u1",
      recipientEmail: "marc@example.com",
      draftIntent: "follow up",
      k: 1,
    });

    // Body returned to caller should be sig-stripped — what Jennifer
    // actually wrote, ready to be injected into a few-shot prompt.
    expect(out[0].body).toContain("Thanks for sending");
    expect(out[0].body).not.toContain("Jennifer Aaker");
    expect(out[0].body).not.toContain("Website");
  });
});
