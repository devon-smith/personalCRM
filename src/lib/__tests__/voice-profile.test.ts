import { describe, it, expect } from "vitest";
import { buildLearnedProfile, applyOverrides } from "@/lib/voice/profile";

function mkExample(overrides: {
  relationshipType?: string;
  openingType?: string | null;
  closingType?: string | null;
  wordCount?: number;
  avgSentenceLen?: number;
  signaturePhrases?: string[];
} = {}) {
  return {
    relationshipType: overrides.relationshipType ?? "former_student",
    openingType: overrides.openingType ?? "first_name",
    closingType: overrides.closingType ?? "warmly",
    wordCount: overrides.wordCount ?? 80,
    avgSentenceLen: overrides.avgSentenceLen ?? 14,
    signaturePhrases: overrides.signaturePhrases ?? [],
  };
}

describe("buildLearnedProfile", () => {
  it("groups examples by relationship type", () => {
    const profile = buildLearnedProfile([
      mkExample({ relationshipType: "former_student" }),
      mkExample({ relationshipType: "former_student" }),
      mkExample({ relationshipType: "board" }),
    ]);
    expect(profile.byRelationship.former_student.count).toBe(2);
    expect(profile.byRelationship.board.count).toBe(1);
    expect(profile.byRelationship.industry_exec.count).toBe(0);
  });

  it("ranks greetings by frequency with correct percentages", () => {
    const profile = buildLearnedProfile([
      mkExample({ openingType: "first_name" }),
      mkExample({ openingType: "first_name" }),
      mkExample({ openingType: "first_name" }),
      mkExample({ openingType: "hi" }),
    ]);
    const greetings = profile.byRelationship.former_student.greetings;
    expect(greetings[0]).toEqual({ value: "first_name", count: 3, pct: 75 });
    expect(greetings[1]).toEqual({ value: "hi", count: 1, pct: 25 });
  });

  it("computes median word count, not mean (outlier-robust)", () => {
    const profile = buildLearnedProfile([
      mkExample({ wordCount: 50 }),
      mkExample({ wordCount: 60 }),
      mkExample({ wordCount: 70 }),
      mkExample({ wordCount: 9999 }), // outlier (long-form essay)
    ]);
    // Median of [50, 60, 70, 9999] = (60+70)/2 = 65.
    expect(profile.byRelationship.former_student.wordCountMedian).toBe(65);
  });

  it("computes mean sentence length", () => {
    const profile = buildLearnedProfile([
      mkExample({ avgSentenceLen: 10 }),
      mkExample({ avgSentenceLen: 14 }),
      mkExample({ avgSentenceLen: 18 }),
    ]);
    expect(profile.byRelationship.former_student.avgSentenceLen).toBe(14);
  });

  it("surfaces signature phrases that recur in ≥5 emails", () => {
    const recurring = "love to know what you think";
    const oneOff = "happens to be unique";
    const examples = [
      ...Array.from({ length: 5 }, () =>
        mkExample({ signaturePhrases: [recurring] }),
      ),
      mkExample({ signaturePhrases: [oneOff] }),
    ];
    const profile = buildLearnedProfile(examples);
    const phrases = profile.byRelationship.former_student.signaturePhrases;
    expect(phrases.map((p) => p.value)).toContain(recurring);
    expect(phrases.map((p) => p.value)).not.toContain(oneOff);
  });

  it("counts a phrase once per email even if it appears multiple times", () => {
    const phrase = "love to know what you think";
    const examples = Array.from({ length: 5 }, () =>
      mkExample({ signaturePhrases: [phrase, phrase, phrase] }), // 3x within one email
    );
    const profile = buildLearnedProfile(examples);
    const entry = profile.byRelationship.former_student.signaturePhrases.find(
      (p) => p.value === phrase,
    );
    expect(entry?.count).toBe(5); // not 15
  });

  it("falls unknown-relationship examples into the 'unknown' bucket", () => {
    const profile = buildLearnedProfile([
      mkExample({ relationshipType: "nonsense_value" }),
    ]);
    expect(profile.byRelationship.unknown.count).toBe(1);
  });

  it("surfaces neverSays phrases that don't appear anywhere", () => {
    const profile = buildLearnedProfile([
      mkExample({ signaturePhrases: ["love to know what you think"] }),
    ]);
    expect(profile.neverSays).toContain("hope this finds you well");
    expect(profile.neverSays).toContain("touch base");
  });

  it("removes a stock phrase from neverSays once observed", () => {
    const profile = buildLearnedProfile([
      mkExample({ signaturePhrases: ["hope this finds you well"] }),
    ]);
    expect(profile.neverSays).not.toContain("hope this finds you well");
  });
});

describe("applyOverrides", () => {
  it("strips removedPhrases from signaturePhrases across all buckets", () => {
    const phrase = "love to know what you think";
    const learned = buildLearnedProfile(
      Array.from({ length: 5 }, () => mkExample({ signaturePhrases: [phrase] })),
    );
    expect(
      learned.byRelationship.former_student.signaturePhrases.some(
        (p) => p.value === phrase,
      ),
    ).toBe(true);

    const filtered = applyOverrides(learned, {
      removedPhrases: [phrase],
      assertions: {},
    });
    expect(
      filtered.byRelationship.former_student.signaturePhrases.some(
        (p) => p.value === phrase,
      ),
    ).toBe(false);
  });

  it("returns identity when no overrides are set", () => {
    const learned = buildLearnedProfile([mkExample()]);
    const out = applyOverrides(learned, { removedPhrases: [], assertions: {} });
    expect(out).toEqual(learned);
  });
});
