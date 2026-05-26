import { describe, it, expect } from "vitest";
import {
  changelogToFeedItem,
  lifeEventToFeedItem,
  shouldHighlight,
} from "@/lib/feed/aggregator";

describe("changelogToFeedItem", () => {
  function mkChangelog(over: Record<string, unknown> = {}) {
    return {
      id: "cl1",
      userId: "u1",
      contactId: "c1",
      type: "ROLE_CHANGE" as const,
      field: "role",
      oldValue: "Engineer",
      newValue: "VP Eng",
      source: "linkedin_reimport",
      detectedAt: new Date("2026-05-20"),
      contact: { name: "Marcus Chen" },
      ...over,
    };
  }

  it("maps ROLE_CHANGE to a job_change feed item", () => {
    const out = changelogToFeedItem(mkChangelog());
    expect(out).not.toBeNull();
    expect(out!.itemType).toBe("job_change");
    expect(out!.headline).toContain("Marcus Chen");
    expect(out!.headline).toContain("VP Eng");
    expect(out!.body).toContain("Engineer");
    expect(out!.sourceType).toBe("changelog");
  });

  it("maps COMPANY_CHANGE with 'is now at' phrasing", () => {
    const out = changelogToFeedItem(
      mkChangelog({
        type: "COMPANY_CHANGE",
        oldValue: "Google",
        newValue: "Anthropic",
      }),
    );
    expect(out!.headline).toContain("is now at Anthropic");
  });

  it("maps NEWS_MENTION to news_mention with linkUrl", () => {
    const out = changelogToFeedItem(
      mkChangelog({
        type: "NEWS_MENTION",
        field: "url",
        oldValue: null,
        newValue: "https://example.com/article",
      }),
    );
    expect(out!.itemType).toBe("news_mention");
    expect(out!.sourceType).toBe("web");
    expect(out!.linkUrl).toBe("https://example.com/article");
    expect(out!.headline).toContain("Marcus Chen");
    expect(out!.headline).toContain("mentioned in the news");
  });

  it("returns null when newValue is missing on a job change", () => {
    const out = changelogToFeedItem(
      mkChangelog({ newValue: null }),
    );
    expect(out).toBeNull();
  });
});

describe("lifeEventToFeedItem", () => {
  function mkLifeEvent(over: Record<string, unknown> = {}) {
    return {
      id: "le1",
      userId: "u1",
      contactId: "c1",
      signalType: "family",
      summary: "I had a baby!",
      sourceType: "email",
      detectedAt: new Date("2026-05-22"),
      contact: { name: "Sarah Park" },
      ...over,
    };
  }

  it("rewrites first-person summary to third-person headline", () => {
    const out = lifeEventToFeedItem(mkLifeEvent());
    expect(out.headline).toContain("Sarah Park");
    expect(out.headline).toContain("I had a baby");
    expect(out.itemType).toBe("life_event");
  });

  it("maps new_role signalType to job_change itemType", () => {
    const out = lifeEventToFeedItem(
      mkLifeEvent({
        signalType: "new_role",
        summary: "Starting at Anthropic next month",
      }),
    );
    expect(out.itemType).toBe("job_change");
  });

  it("maps publication signalType to publication itemType", () => {
    const out = lifeEventToFeedItem(
      mkLifeEvent({
        signalType: "publication",
        summary: "Our paper just came out in Nature",
      }),
    );
    expect(out.itemType).toBe("publication");
  });

  it("preserves contact-name-prefixed summaries without double-prefixing", () => {
    const out = lifeEventToFeedItem(
      mkLifeEvent({
        summary: "Sarah Park just had a baby",
      }),
    );
    // Should NOT be "Sarah Park: Sarah Park just had a baby"
    expect(out.headline).toBe("Sarah Park just had a baby");
  });
});

describe("shouldHighlight", () => {
  it("highlights INNER_CIRCLE contacts unconditionally", () => {
    expect(
      shouldHighlight({
        tier: "INNER_CIRCLE",
        interactionCount: 0,
        itemType: "news_mention",
      }),
    ).toBe(true);
  });

  it("highlights contacts with 20+ interactions", () => {
    expect(
      shouldHighlight({
        tier: "ACQUAINTANCE",
        interactionCount: 25,
        itemType: "publication",
      }),
    ).toBe(true);
  });

  it("highlights life_event for any contact with at least one interaction", () => {
    expect(
      shouldHighlight({
        tier: "ACQUAINTANCE",
        interactionCount: 1,
        itemType: "life_event",
      }),
    ).toBe(true);
  });

  it("does not highlight life_event for strangers", () => {
    expect(
      shouldHighlight({
        tier: "ACQUAINTANCE",
        interactionCount: 0,
        itemType: "life_event",
      }),
    ).toBe(false);
  });

  it("does not highlight low-tier infrequent contacts", () => {
    expect(
      shouldHighlight({
        tier: "ACQUAINTANCE",
        interactionCount: 3,
        itemType: "news_mention",
      }),
    ).toBe(false);
  });
});
