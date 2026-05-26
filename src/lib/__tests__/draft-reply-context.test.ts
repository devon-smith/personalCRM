import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildReplyPromptBlock,
  normalizeThreadId,
  loadReplyContext,
  type ReplyContext,
} from "@/lib/draft-reply-context";
import type { PrismaClient } from "@/generated/prisma/client";

// fetchMessageBody is mocked per-test below so the loader unit tests
// don't reach for the Gmail API.
vi.mock("@/lib/gmail/fetch-body", () => ({
  fetchMessageBody: vi.fn(),
}));
import { fetchMessageBody } from "@/lib/gmail/fetch-body";

const fetchBodyMock = vi.mocked(fetchMessageBody);

beforeEach(() => {
  fetchBodyMock.mockReset();
});

describe("normalizeThreadId", () => {
  it("strips the gmail: prefix", () => {
    expect(normalizeThreadId("gmail:abc123")).toBe("abc123");
  });
  it("returns the raw key when no prefix is present", () => {
    expect(normalizeThreadId("abc123")).toBe("abc123");
  });
});

describe("buildReplyPromptBlock", () => {
  function mkCtx(over: Partial<ReplyContext> = {}): ReplyContext {
    return {
      latestInbound: {
        fromEmail: "marcus@openevidence.ai",
        fromName: "Marcus Chen",
        subject: "Re: paper draft",
        body: "Hey Jennifer,\n\nQuick question — can you review section 3 by Friday? Specifically the framing on intrinsic motivation.\n\nThanks,\nMarcus",
        bodyIsFull: true,
        occurredAt: new Date(Date.now() - 2 * 86400000), // 2 days ago
      },
      threadHistory: [
        {
          direction: "OUTBOUND",
          fromEmail: "jaaker@stanford.edu",
          fromName: "Jennifer Aaker",
          subject: "paper draft",
          snippet: "Marcus, sending over the draft — let me know your thoughts.",
          occurredAt: new Date(Date.now() - 5 * 86400000),
        },
        {
          direction: "INBOUND",
          fromEmail: "marcus@openevidence.ai",
          fromName: "Marcus Chen",
          subject: "Re: paper draft",
          snippet:
            "Hey Jennifer, Quick question — can you review section 3 by Friday?",
          occurredAt: new Date(Date.now() - 2 * 86400000),
        },
      ],
      ...over,
    };
  }

  it("includes 'YOU ARE REPLYING' header verbatim", () => {
    const out = buildReplyPromptBlock(mkCtx());
    expect(out).toContain("YOU ARE REPLYING TO THIS MESSAGE");
    expect(out).toMatch(/do NOT write a generic catch-up email/);
  });

  it("includes the full body of the latest inbound", () => {
    const out = buildReplyPromptBlock(mkCtx());
    expect(out).toContain("review section 3 by Friday");
    expect(out).toContain("intrinsic motivation");
  });

  it("renders sender with name + email", () => {
    const out = buildReplyPromptBlock(mkCtx());
    expect(out).toContain("Marcus Chen <marcus@openevidence.ai>");
  });

  it("falls back to email when no name", () => {
    const out = buildReplyPromptBlock(
      mkCtx({
        latestInbound: {
          ...mkCtx().latestInbound,
          fromName: null,
        },
      }),
    );
    expect(out).toContain("marcus@openevidence.ai");
    expect(out).not.toMatch(/null <marcus/);
  });

  it("includes the subject line", () => {
    const out = buildReplyPromptBlock(mkCtx());
    expect(out).toContain("Subject: Re: paper draft");
  });

  it("renders prior thread history (excluding the latest inbound)", () => {
    const out = buildReplyPromptBlock(mkCtx());
    expect(out).toContain("PRIOR THREAD CONTEXT");
    expect(out).toContain("You");
    expect(out).toContain("sending over the draft");
    // The latest inbound is rendered in full, not as a history line —
    // so this excerpt should NOT appear in the history block.
    const historyBlock = out.split("THE MESSAGE TO REPLY TO:")[0];
    expect(historyBlock).not.toContain("Marcus Chen [Re: paper draft]");
  });

  it("omits the thread history block when there's only one message", () => {
    const single = mkCtx({
      threadHistory: [mkCtx().threadHistory[1]],
    });
    const out = buildReplyPromptBlock(single);
    expect(out).not.toContain("PRIOR THREAD CONTEXT");
  });

  it("warns the model when only a snippet is available", () => {
    const snippetOnly = mkCtx({
      latestInbound: {
        ...mkCtx().latestInbound,
        body: "Hey Jennifer, quick question (snippet only)",
        bodyIsFull: false,
      },
    });
    const out = buildReplyPromptBlock(snippetOnly);
    expect(out).toContain("only the message snippet is available");
    expect(out).toMatch(/without inventing details/);
  });

  it("does NOT add the snippet warning when full body is loaded", () => {
    const out = buildReplyPromptBlock(mkCtx());
    expect(out).not.toContain("only the message snippet is available");
  });
});

describe("loadReplyContext", () => {
  function mkPrisma(overrides: {
    emailMessages?: Array<Record<string, unknown>>;
    gmailIdLookup?: { gmailId: string } | null;
    updateThrows?: boolean;
  }) {
    const findMany = vi.fn(async () => overrides.emailMessages ?? []);
    const findUnique = vi.fn(async () => overrides.gmailIdLookup ?? null);
    const update = vi.fn(async () => {
      if (overrides.updateThrows) throw new Error("DB down");
    });
    return {
      prisma: {
        emailMessage: { findMany, findUnique, update },
      } as unknown as PrismaClient,
      spies: { findMany, findUnique, update },
    };
  }

  it("returns null when the thread has no messages", async () => {
    const { prisma } = mkPrisma({ emailMessages: [] });
    const out = await loadReplyContext({
      prisma,
      userId: "u1",
      threadKey: "gmail:t1",
    });
    expect(out).toBeNull();
  });

  it("returns null when the thread has no inbound message", async () => {
    const { prisma } = mkPrisma({
      emailMessages: [
        {
          id: "m1",
          direction: "OUTBOUND",
          fromEmail: "me@me.com",
          fromName: "Me",
          subject: "hi",
          snippet: "hello",
          fullBody: null,
          occurredAt: new Date(),
        },
      ],
    });
    const out = await loadReplyContext({
      prisma,
      userId: "u1",
      threadKey: "gmail:t1",
    });
    expect(out).toBeNull();
  });

  it("uses cached fullBody when present (no Gmail fetch)", async () => {
    const { prisma, spies } = mkPrisma({
      emailMessages: [
        {
          id: "m1",
          direction: "INBOUND",
          fromEmail: "marcus@a.com",
          fromName: "Marcus",
          subject: "hello",
          snippet: "short",
          fullBody: "FULL CACHED BODY",
          occurredAt: new Date(),
        },
      ],
    });
    const out = await loadReplyContext({
      prisma,
      userId: "u1",
      threadKey: "gmail:t1",
    });
    expect(out?.latestInbound.body).toBe("FULL CACHED BODY");
    expect(out?.latestInbound.bodyIsFull).toBe(true);
    expect(fetchBodyMock).not.toHaveBeenCalled();
    expect(spies.findUnique).not.toHaveBeenCalled();
  });

  it("fetches from Gmail when fullBody is null and persists the result", async () => {
    const { prisma, spies } = mkPrisma({
      emailMessages: [
        {
          id: "m1",
          direction: "INBOUND",
          fromEmail: "marcus@a.com",
          fromName: "Marcus",
          subject: "hello",
          snippet: "short snippet",
          fullBody: null,
          occurredAt: new Date(),
        },
      ],
      gmailIdLookup: { gmailId: "gid-1" },
    });
    fetchBodyMock.mockResolvedValueOnce({
      gmailId: "gid-1",
      body: "FETCHED FULL BODY",
      fromHtml: false,
    });
    const out = await loadReplyContext({
      prisma,
      userId: "u1",
      threadKey: "gmail:t1",
    });
    expect(out?.latestInbound.body).toBe("FETCHED FULL BODY");
    expect(out?.latestInbound.bodyIsFull).toBe(true);
    expect(fetchBodyMock).toHaveBeenCalledWith("u1", "gid-1");
    expect(spies.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { fullBody: "FETCHED FULL BODY" },
    });
  });

  it("falls back to snippet when Gmail fetch fails", async () => {
    const { prisma, spies } = mkPrisma({
      emailMessages: [
        {
          id: "m1",
          direction: "INBOUND",
          fromEmail: "marcus@a.com",
          fromName: "Marcus",
          subject: "hello",
          snippet: "short snippet",
          fullBody: null,
          occurredAt: new Date(),
        },
      ],
      gmailIdLookup: { gmailId: "gid-1" },
    });
    fetchBodyMock.mockRejectedValueOnce(new Error("Gmail unavailable"));
    const out = await loadReplyContext({
      prisma,
      userId: "u1",
      threadKey: "gmail:t1",
    });
    expect(out?.latestInbound.body).toBe("short snippet");
    expect(out?.latestInbound.bodyIsFull).toBe(false);
    expect(spies.update).not.toHaveBeenCalled();
  });

  it("falls back to snippet when Gmail returns null body (404 / deleted)", async () => {
    const { prisma } = mkPrisma({
      emailMessages: [
        {
          id: "m1",
          direction: "INBOUND",
          fromEmail: "marcus@a.com",
          fromName: "Marcus",
          subject: "hello",
          snippet: "snip",
          fullBody: null,
          occurredAt: new Date(),
        },
      ],
      gmailIdLookup: { gmailId: "gid-1" },
    });
    fetchBodyMock.mockResolvedValueOnce(null);
    const out = await loadReplyContext({
      prisma,
      userId: "u1",
      threadKey: "gmail:t1",
    });
    expect(out?.latestInbound.body).toBe("snip");
    expect(out?.latestInbound.bodyIsFull).toBe(false);
  });

  it("orders threadHistory oldest-first for the prompt", async () => {
    // findMany returns newest first (occurredAt desc); the loader
    // must reverse before returning.
    const newest = new Date("2026-05-20");
    const middle = new Date("2026-05-15");
    const oldest = new Date("2026-05-10");
    const { prisma } = mkPrisma({
      emailMessages: [
        {
          id: "newest",
          direction: "INBOUND",
          fromEmail: "marcus@a.com",
          fromName: "Marcus",
          subject: "Re: thing",
          snippet: "newest",
          fullBody: "newest body",
          occurredAt: newest,
        },
        {
          id: "middle",
          direction: "OUTBOUND",
          fromEmail: "me@me.com",
          fromName: "Me",
          subject: "Re: thing",
          snippet: "middle",
          fullBody: null,
          occurredAt: middle,
        },
        {
          id: "oldest",
          direction: "INBOUND",
          fromEmail: "marcus@a.com",
          fromName: "Marcus",
          subject: "thing",
          snippet: "oldest",
          fullBody: null,
          occurredAt: oldest,
        },
      ],
    });
    const out = await loadReplyContext({
      prisma,
      userId: "u1",
      threadKey: "gmail:t1",
    });
    expect(out?.threadHistory.map((m) => m.snippet)).toEqual([
      "oldest",
      "middle",
      "newest",
    ]);
    // Latest inbound is the newest (returned by findMany at index 0).
    expect(out?.latestInbound.body).toBe("newest body");
  });

  it("returns null for empty threadKey", async () => {
    const { prisma } = mkPrisma({ emailMessages: [] });
    const out = await loadReplyContext({
      prisma,
      userId: "u1",
      threadKey: "",
    });
    expect(out).toBeNull();
  });
});
