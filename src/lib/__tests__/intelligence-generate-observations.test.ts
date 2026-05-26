import { describe, it, expect } from "vitest";
import {
  phraseSignal,
  lifeEventDetail,
  type Signal,
} from "@/lib/intelligence/generate-observations";

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
