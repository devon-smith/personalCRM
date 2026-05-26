import { describe, it, expect } from "vitest";
import { buildMemorySummary } from "@/lib/draft-generator";

describe("buildMemorySummary (M8.3)", () => {
  it("returns empty string when every section is empty", () => {
    expect(
      buildMemorySummary({
        discussedTopics: [],
        theyMentioned: [],
        openThreads: [],
        personalContext: {},
        recurringThemes: [],
      }),
    ).toBe("");
  });

  it("formats personal context as a single line", () => {
    const out = buildMemorySummary({
      discussedTopics: [],
      theyMentioned: [],
      openThreads: [],
      personalContext: { family: "wife Jess, two kids", location: "SF" },
      recurringThemes: [],
    });
    expect(out).toContain("Personal context:");
    expect(out).toContain("family: wife Jess, two kids");
    expect(out).toContain("location: SF");
  });

  it("includes recurring themes when present", () => {
    const out = buildMemorySummary({
      discussedTopics: [],
      theyMentioned: [],
      openThreads: [],
      personalContext: {},
      recurringThemes: ["AI strategy", "team building"],
    });
    expect(out).toContain("Recurring themes: AI strategy, team building");
  });

  it("renders open threads with who-raised tags", () => {
    const out = buildMemorySummary({
      discussedTopics: [],
      theyMentioned: [],
      openThreads: [
        {
          subject: "intro to Sarah",
          raisedBy: "them",
          raisedAt: "2026-05-08",
          status: "open",
        },
        {
          subject: "send revised deck",
          raisedBy: "user",
          raisedAt: "2026-05-12",
          status: "stale",
        },
      ],
      personalContext: {},
      recurringThemes: [],
    });
    expect(out).toContain("Open threads:");
    expect(out).toContain("They (2026-05-08): intro to Sarah");
    expect(out).toContain("You (2026-05-12): send revised deck");
  });

  it("excludes resolved threads from open-threads section", () => {
    const out = buildMemorySummary({
      discussedTopics: [],
      theyMentioned: [],
      openThreads: [
        {
          subject: "intro to Sarah",
          raisedBy: "them",
          raisedAt: "2026-05-08",
          status: "open",
        },
        {
          subject: "old item",
          raisedBy: "them",
          raisedAt: "2026-01-01",
          status: "resolved",
        },
      ],
      personalContext: {},
      recurringThemes: [],
    });
    expect(out).toContain("intro to Sarah");
    expect(out).not.toContain("old item");
  });

  it("renders they-mentioned with context + date", () => {
    const out = buildMemorySummary({
      discussedTopics: [],
      theyMentioned: [
        {
          subject: "daughter applying to Stanford",
          context: "in May 12 email about visit planning",
          mentionedAt: "2026-05-12",
        },
      ],
      openThreads: [],
      personalContext: {},
      recurringThemes: [],
    });
    expect(out).toContain("They've mentioned about themselves:");
    expect(out).toContain("daughter applying to Stanford");
    expect(out).toContain("(in May 12 email about visit planning)");
    expect(out).toContain("[2026-05-12]");
  });

  it("caps each list at 5 entries to bound prompt size", () => {
    const out = buildMemorySummary({
      discussedTopics: [],
      theyMentioned: Array.from({ length: 10 }, (_, i) => ({
        subject: `mention ${i}`,
        context: "x",
        mentionedAt: "2026-01-01",
      })),
      openThreads: Array.from({ length: 10 }, (_, i) => ({
        subject: `thread ${i}`,
        raisedBy: "them",
        raisedAt: "2026-01-01",
        status: "open",
      })),
      personalContext: {},
      recurringThemes: [],
    });
    expect(out).toContain("mention 4");
    expect(out).not.toContain("mention 5");
    expect(out).toContain("thread 4");
    expect(out).not.toContain("thread 5");
  });

  it("handles unexpected JSON shapes gracefully", () => {
    // Defensive: Prisma columns come back as `unknown` and could in
    // principle contain malformed data from a future schema migration
    // or hand-edited row.
    const out = buildMemorySummary({
      discussedTopics: "not an array",
      theyMentioned: null,
      openThreads: { not: "an array either" },
      personalContext: "string instead of object",
      recurringThemes: [],
    });
    expect(out).toBe("");
  });

  it("ignores personal context entries with non-string values", () => {
    const out = buildMemorySummary({
      discussedTopics: [],
      theyMentioned: [],
      openThreads: [],
      personalContext: {
        family: "wife Jess",
        numericValue: 42,
        objectValue: { nested: true },
        emptyString: "",
      },
      recurringThemes: [],
    });
    expect(out).toContain("family: wife Jess");
    expect(out).not.toContain("numericValue");
    expect(out).not.toContain("objectValue");
    expect(out).not.toContain("emptyString");
  });
});
