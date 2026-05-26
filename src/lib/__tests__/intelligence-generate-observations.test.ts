import { describe, it, expect, vi } from "vitest";
import {
  phraseSignal,
  lifeEventDetail,
  dropAnsweredByThread,
  findEnumLikeToken,
  type Signal,
} from "@/lib/intelligence/generate-observations";
import type { PrismaClient } from "@/generated/prisma/client";

function mkSignal(over: Partial<Signal> = {}): Signal {
  return {
    source: "unanswered_inbound",
    contactId: "c1",
    contactName: "Marc Beban",
    detail: "the deck",
    refs: ["interaction:i1"],
    observedAt: new Date("2026-05-20"),
    ...over,
  };
}

describe("phraseSignal", () => {
  it("phrases unanswered_inbound as a peer-like nudge, not a todo", () => {
    const out = phraseSignal(
      mkSignal({ source: "unanswered_inbound", detail: '"Section 3 framing"' }),
    );
    // Uses first name, references the topic, calls it "open on your
    // side" rather than "URGENT" / "ACTION REQUIRED".
    expect(out.content).toMatch(/^Marc /);
    expect(out.content).toContain("Section 3 framing");
    expect(out.content).toContain("open on your side");
    expect(out.content).not.toMatch(/urgent|action required|overdue/i);
  });

  it("phrases stale_open_thread with the who-raised tag", () => {
    const out = phraseSignal(
      mkSignal({
        source: "stale_open_thread",
        contactName: "Sarah Chen",
        detail: "they asked about sabbatical timing",
      }),
    );
    expect(out.content).toMatch(/^Open thread with Sarah/);
    expect(out.content).toContain("sabbatical timing");
    expect(out.content).toContain("Hasn't moved");
  });

  it("phrases recent_life_event as a noticing", () => {
    const out = phraseSignal(
      mkSignal({
        source: "recent_life_event",
        contactName: "David Park",
        detail: "is now at Anthropic",
      }),
    );
    // No urgency language. Just observation.
    expect(out.content).toBe("David is now at Anthropic.");
  });

  it("phrases dormant_inner_circle gently", () => {
    const out = phraseSignal(
      mkSignal({
        source: "dormant_inner_circle",
        contactName: "Marcus Aurelius",
        detail: "you haven't connected since 2026-01-15",
      }),
    );
    expect(out.content).toMatch(/Marcus's in your inner circle/);
    expect(out.content).toContain("2026-01-15");
  });

  it("uses just the first name, never the full name in body", () => {
    const out = phraseSignal(
      mkSignal({ contactName: "Marc Beban", source: "unanswered_inbound" }),
    );
    expect(out.content).toContain("Marc ");
    expect(out.content).not.toContain("Marc Beban");
  });

  it("strips surrounding quotes from the detail", () => {
    const out = phraseSignal(
      mkSignal({
        source: "unanswered_inbound",
        detail: '"Q3 product strategy"',
      }),
    );
    expect(out.content).toContain("Q3 product strategy");
    expect(out.content).not.toContain('"Q3 product strategy"');
  });

  it("preserves source + refs in the draft for AIGenerationLog provenance", () => {
    const out = phraseSignal(
      mkSignal({
        source: "unanswered_inbound",
        refs: ["interaction:abc", "interaction:def"],
      }),
    );
    expect(out.source).toBe("unanswered_inbound");
    expect(out.sourceRefs).toEqual(["interaction:abc", "interaction:def"]);
    expect(out.contactId).toBe("c1");
  });

  it("falls back to generic phrasing for unknown sources", () => {
    const out = phraseSignal(
      mkSignal({
        source: "future_signal_type",
        contactName: "Test Person",
        detail: "some new signal",
      }),
    );
    expect(out.content).toBe("Test: some new signal.");
  });
});

describe("lifeEventDetail — no enum leaks", () => {
  // Regression: the production data had ContactChangelog rows where
  // field="web_mention" and the old phrasing said "was mentioned
  // recently in web_mention". Leaked an internal enum value into
  // user-facing copy. Verify the fix.

  it("NEWS_MENTION uses the article title from oldValue", () => {
    expect(
      lifeEventDetail({
        type: "NEWS_MENTION",
        field: "web_mention",
        oldValue: "Stanford GSB Announces New Faculty Initiative",
        newValue: "https://gsb.stanford.edu/news/...",
      }),
    ).toBe(
      'was mentioned recently — "Stanford GSB Announces New Faculty Initiative"',
    );
  });

  it("NEWS_MENTION falls back to generic phrasing when oldValue is empty", () => {
    expect(
      lifeEventDetail({
        type: "NEWS_MENTION",
        field: "web_mention",
        oldValue: "",
        newValue: null,
      }),
    ).toBe("was mentioned in the news recently");
    expect(
      lifeEventDetail({
        type: "NEWS_MENTION",
        field: "web_mention",
        oldValue: null,
        newValue: null,
      }),
    ).toBe("was mentioned in the news recently");
  });

  it("NEWS_MENTION truncates long article titles", () => {
    const longTitle = "a".repeat(120);
    const out = lifeEventDetail({
      type: "NEWS_MENTION",
      field: "web_mention",
      oldValue: longTitle,
      newValue: null,
    });
    expect(out).toContain("…");
    expect(out.length).toBeLessThan(longTitle.length);
  });

  it("never leaks the `field` enum string into NEWS_MENTION copy", () => {
    const out = lifeEventDetail({
      type: "NEWS_MENTION",
      field: "web_mention",
      oldValue: null,
      newValue: null,
    });
    expect(out).not.toContain("web_mention");
  });

  it("default fallback never leaks `field` either", () => {
    const out = lifeEventDetail({
      type: "UNKNOWN_FUTURE_TYPE",
      field: "internal_enum_value_should_not_appear",
      oldValue: "an old value",
      newValue: "a new value",
    });
    expect(out).toBe("had a recent life update");
    expect(out).not.toContain("internal_enum");
    expect(out).not.toContain("→"); // the old "field → newValue" leak
  });

  it("JOB_CHANGE / COMPANY_CHANGE / ROLE_CHANGE unchanged", () => {
    expect(
      lifeEventDetail({
        type: "JOB_CHANGE",
        field: "company",
        oldValue: "Acme",
        newValue: "Anthropic",
      }),
    ).toBe("is now at Anthropic");
    expect(
      lifeEventDetail({
        type: "COMPANY_CHANGE",
        field: "company",
        oldValue: null,
        newValue: "Stripe",
      }),
    ).toBe("is now at Stripe");
    expect(
      lifeEventDetail({
        type: "ROLE_CHANGE",
        field: "title",
        oldValue: "Engineer",
        newValue: "VP Engineering",
      }),
    ).toBe("has a new role: VP Engineering");
  });
});

describe("dropAnsweredByThread (M0.5)", () => {
  /**
   * Hand-rolls a minimal PrismaClient stub. We only call
   * interaction.findMany; everything else is unused so we cast to
   * the full type at the boundary.
   */
  function mockPrisma(outbounds: Array<{ threadId: string; occurredAt: Date }>) {
    return {
      interaction: {
        findMany: vi.fn(async () => outbounds),
      },
    } as unknown as PrismaClient;
  }

  it("returns all candidates when no OUTBOUND exists", async () => {
    const prisma = mockPrisma([]);
    const candidates = [
      { id: "i1", threadId: "t1", occurredAt: new Date("2026-05-01") },
      { id: "i2", threadId: "t2", occurredAt: new Date("2026-05-02") },
    ];
    const result = await dropAnsweredByThread(prisma, "u1", candidates);
    expect(result.map((r) => r.id)).toEqual(["i1", "i2"]);
  });

  it("drops candidates with a later OUTBOUND in the same thread", async () => {
    const prisma = mockPrisma([
      { threadId: "t1", occurredAt: new Date("2026-05-05") },
    ]);
    const candidates = [
      { id: "i1", threadId: "t1", occurredAt: new Date("2026-05-01") },
      { id: "i2", threadId: "t2", occurredAt: new Date("2026-05-02") },
    ];
    const result = await dropAnsweredByThread(prisma, "u1", candidates);
    expect(result.map((r) => r.id)).toEqual(["i2"]);
  });

  it("keeps candidates when the OUTBOUND is OLDER than the inbound", async () => {
    // Inbound at 5/10, outbound at 5/01 — they wrote first, then you got
    // a new inbound. We have NOT replied to this one yet.
    const prisma = mockPrisma([
      { threadId: "t1", occurredAt: new Date("2026-05-01") },
    ]);
    const candidates = [
      { id: "i1", threadId: "t1", occurredAt: new Date("2026-05-10") },
    ];
    const result = await dropAnsweredByThread(prisma, "u1", candidates);
    expect(result.map((r) => r.id)).toEqual(["i1"]);
  });

  it("keeps candidates with no threadId (legacy / non-email rows)", async () => {
    const prisma = mockPrisma([]);
    const candidates = [
      { id: "i1", threadId: null, occurredAt: new Date("2026-05-01") },
    ];
    const result = await dropAnsweredByThread(prisma, "u1", candidates);
    expect(result.map((r) => r.id)).toEqual(["i1"]);
  });

  it("returns [] for an empty candidate list and skips DB call", async () => {
    const prisma = mockPrisma([]);
    const result = await dropAnsweredByThread(prisma, "u1", []);
    expect(result).toEqual([]);
    // No DB roundtrip needed.
    expect(
      (prisma as unknown as { interaction: { findMany: ReturnType<typeof vi.fn> } })
        .interaction.findMany,
    ).not.toHaveBeenCalled();
  });

  it("respects only the LATEST OUTBOUND per thread for the comparison", async () => {
    // Two outbounds in the same thread: one older than the inbound,
    // one newer. The newer one must rule the comparison.
    const prisma = mockPrisma([
      { threadId: "t1", occurredAt: new Date("2026-04-01") }, // older
      { threadId: "t1", occurredAt: new Date("2026-05-15") }, // newer
    ]);
    const candidates = [
      { id: "i1", threadId: "t1", occurredAt: new Date("2026-05-10") },
    ];
    const result = await dropAnsweredByThread(prisma, "u1", candidates);
    expect(result).toEqual([]);
  });
});

describe("findEnumLikeToken (M0.9 regression guard)", () => {
  // Historical leak: ContactChangelog field strings like
  // "web_mention" and "company_field" reached user-facing content.
  // Fixed in 1333971; these tests ensure the regression can't
  // sneak back in via a new ChangelogType without a humanizer.

  it.each([
    "Jonathan was mentioned recently in web_mention.",
    "Sarah's company_field updated",
    "Mark shared a linkedin_post",
    "Updated the inner_circle assignment",
    "this is a multi_word_token leak",
  ])('flags enum-shaped token in "%s"', (content) => {
    expect(findEnumLikeToken(content)).not.toBeNull();
  });

  it("returns null on natural-language observations", () => {
    expect(
      findEnumLikeToken("Marc asked about Section 3 framing a few days ago"),
    ).toBeNull();
    expect(
      findEnumLikeToken("David is now at Anthropic."),
    ).toBeNull();
    expect(
      findEnumLikeToken(
        "Open thread with Sarah: they asked about sabbatical timing.",
      ),
    ).toBeNull();
    expect(
      findEnumLikeToken(
        "Marcus is in your inner circle; you haven't connected since 2026-01-15.",
      ),
    ).toBeNull();
  });

  it("does not match hyphenated words or emails", () => {
    // Hyphens, not underscores
    expect(findEnumLikeToken("She's a sabbatical-bound researcher")).toBeNull();
    // Emails (won't be in observation copy anyway, but verify)
    expect(
      findEnumLikeToken("Reach her at jane.doe@example.com tomorrow"),
    ).toBeNull();
  });

  it("returns the first offending token, not all of them", () => {
    const found = findEnumLikeToken("web_mention then company_field");
    expect(found).toBe("web_mention");
  });

  /**
   * End-to-end sweep: drive phraseSignal across every known source
   * + every ChangelogType (the historical leak vector) and assert
   * none of the rendered drafts leak. Catches any future signal-
   * source / lifeEventDetail divergence.
   */
  describe("phraseSignal end-to-end sweep", () => {
    const baseSig = (over: Partial<Signal>): Signal => ({
      source: "unanswered_inbound",
      contactId: "c1",
      contactName: "Test Person",
      detail: "something",
      refs: ["interaction:i1"],
      observedAt: new Date(),
      ...over,
    });

    const sources = [
      "unanswered_inbound",
      "stale_open_thread",
      "recent_life_event",
      "dormant_inner_circle",
      "future_unknown_source", // exercises the default branch
    ];

    const changelogTypes = [
      "JOB_CHANGE",
      "ROLE_CHANGE",
      "COMPANY_CHANGE",
      "NEWS_MENTION",
      "UNKNOWN_FUTURE_TYPE", // exercises the default branch
    ];

    for (const source of sources) {
      it(`source="${source}" produces clean copy`, () => {
        const out = phraseSignal(
          baseSig({ source, detail: "a topic worth discussing" }),
        );
        const leak = findEnumLikeToken(out.content);
        expect(
          leak,
          `Leaked enum-like token "${leak}" in: ${out.content}`,
        ).toBeNull();
      });
    }

    for (const type of changelogTypes) {
      it(`recent_life_event for changelog="${type}" produces clean copy`, () => {
        // Drive lifeEventDetail with the historic leaky `field`
        // value ("web_mention") to verify the humanizer keeps
        // suppressing the enum, then wrap in phraseSignal and
        // assert end-to-end cleanliness.
        const detail = lifeEventDetail({
          type,
          field: "web_mention",
          oldValue: null,
          newValue: "Anthropic",
        });
        const out = phraseSignal(
          baseSig({ source: "recent_life_event", detail }),
        );
        const leak = findEnumLikeToken(out.content);
        expect(
          leak,
          `Leaked enum-like token "${leak}" in: ${out.content}`,
        ).toBeNull();
      });
    }
  });
});
