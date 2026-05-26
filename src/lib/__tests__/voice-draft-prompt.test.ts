import { describe, it, expect } from "vitest";
import {
  hasVoiceContext,
  buildVoiceBlock,
  buildClosingGuidance,
} from "@/lib/voice/draft-prompt";
import type { LearnedProfile } from "@/lib/voice/profile";
import type { VoiceExampleResult } from "@/lib/voice/few-shot-retrieval";

function mkProfile(overrides?: Partial<LearnedProfile>): LearnedProfile {
  return {
    byRelationship: {
      former_student: {
        count: 30,
        greetings: [
          { value: "first_name", count: 22, pct: 73 },
          { value: "hi", count: 5, pct: 17 },
        ],
        closings: [
          { value: "warmly", count: 13, pct: 43 },
          { value: "none", count: 9, pct: 30 },
        ],
        avgSentenceLen: 14,
        wordCountMedian: 60,
        signaturePhrases: [
          { value: "love to know what you think", count: 8, pct: 27 },
          { value: "looking forward to", count: 6, pct: 20 },
        ],
      },
      peer_faculty: { count: 0, greetings: [], closings: [], avgSentenceLen: 0, wordCountMedian: 0, signaturePhrases: [] },
      industry_exec: { count: 0, greetings: [], closings: [], avgSentenceLen: 0, wordCountMedian: 0, signaturePhrases: [] },
      media: { count: 0, greetings: [], closings: [], avgSentenceLen: 0, wordCountMedian: 0, signaturePhrases: [] },
      family: { count: 0, greetings: [], closings: [], avgSentenceLen: 0, wordCountMedian: 0, signaturePhrases: [] },
      board: { count: 0, greetings: [], closings: [], avgSentenceLen: 0, wordCountMedian: 0, signaturePhrases: [] },
      casual: { count: 0, greetings: [], closings: [], avgSentenceLen: 0, wordCountMedian: 0, signaturePhrases: [] },
      unknown: { count: 0, greetings: [], closings: [], avgSentenceLen: 0, wordCountMedian: 0, signaturePhrases: [] },
    },
    neverSays: ["hope this finds you well", "touch base"],
    overallCount: 30,
    generatedAt: Date.now(),
    ...overrides,
  };
}

function mkExample(overrides?: Partial<VoiceExampleResult>): VoiceExampleResult {
  return {
    emailMessageId: "e1",
    toEmail: "marc@example.com",
    recipientName: "Marc Beban",
    sentAt: new Date("2026-05-20"),
    relationshipType: "former_student",
    matchKind: "primary",
    openingType: "first_name",
    closingType: "warmly",
    wordCount: 60,
    avgSentenceLen: 14,
    body: "Marc,\n\nThanks for sending. Quick thought on section 3.",
    similarity: 0.87,
    ...overrides,
  };
}

describe("hasVoiceContext", () => {
  it("returns true when there are retrieved examples", () => {
    expect(
      hasVoiceContext({
        learnedProfile: null,
        examples: [mkExample()],
        relationshipType: "former_student",
      }),
    ).toBe(true);
  });

  it("returns true when there's a profile bucket with examples", () => {
    expect(
      hasVoiceContext({
        learnedProfile: mkProfile(),
        examples: [],
        relationshipType: "former_student",
      }),
    ).toBe(true);
  });

  it("returns false when nothing applies", () => {
    expect(
      hasVoiceContext({
        learnedProfile: mkProfile(),
        examples: [],
        relationshipType: "peer_faculty", // count=0 bucket
      }),
    ).toBe(false);
    expect(
      hasVoiceContext({
        learnedProfile: null,
        examples: [],
        relationshipType: "former_student",
      }),
    ).toBe(false);
  });
});

describe("buildVoiceBlock", () => {
  it("returns null when there's no voice context", () => {
    expect(
      buildVoiceBlock({
        learnedProfile: null,
        examples: [],
        relationshipType: "former_student",
      }),
    ).toBeNull();
  });

  it("includes the bucket summary when profile present", () => {
    const block = buildVoiceBlock({
      learnedProfile: mkProfile(),
      examples: [],
      relationshipType: "former_student",
    });
    expect(block).toContain("30 of the user's past emails");
    expect(block).toContain('"Marc," (just first name)');
    expect(block).toContain("73%");
    expect(block).toContain("~14 words per sentence");
    expect(block).toContain("~60 words");
    expect(block).toContain("love to know what you think");
  });

  it("renders examples with recipient + date headers", () => {
    const ex = mkExample({
      recipientName: "Marc Beban",
      sentAt: new Date("2026-05-20T15:30:00Z"),
    });
    const block = buildVoiceBlock({
      learnedProfile: null,
      examples: [ex],
      relationshipType: "former_student",
    });
    expect(block).toContain("EXAMPLE 1 — to Marc Beban, 2026-05-20");
    expect(block).toContain("Thanks for sending");
  });

  it("flags fallback examples explicitly", () => {
    const block = buildVoiceBlock({
      learnedProfile: null,
      examples: [mkExample({ matchKind: "fallback" })],
      relationshipType: "former_student",
    });
    expect(block).toContain("cross-type — closest available");
  });

  it("falls back to toEmail when recipientName is null", () => {
    const block = buildVoiceBlock({
      learnedProfile: null,
      examples: [mkExample({ recipientName: null, toEmail: "anon@example.com" })],
      relationshipType: "former_student",
    });
    expect(block).toContain("to anon@example.com");
  });

  it("includes neverSays when profile has them", () => {
    const block = buildVoiceBlock({
      learnedProfile: mkProfile(),
      examples: [],
      relationshipType: "former_student",
    });
    expect(block).toContain("never uses");
    expect(block).toContain('"hope this finds you well"');
    expect(block).toContain('"touch base"');
  });

  it("omits neverSays section when array is empty", () => {
    const block = buildVoiceBlock({
      learnedProfile: mkProfile({ neverSays: [] }),
      examples: [],
      relationshipType: "former_student",
    });
    expect(block).not.toContain("never uses");
  });
});

describe("buildClosingGuidance", () => {
  it("returns empty string when no bucket data", () => {
    expect(
      buildClosingGuidance({
        learnedProfile: null,
        examples: [],
        relationshipType: "former_student",
      }),
    ).toBe("");
  });

  it("instructs no-closing when 'none' dominates (M6.1.1 insight)", () => {
    // Casual bucket where 90.8% of emails have no explicit closing —
    // sig block handles sign-off. Draft shouldn't add a closing line.
    const profile = mkProfile({
      byRelationship: {
        ...mkProfile().byRelationship,
        casual: {
          count: 65,
          greetings: [{ value: "first_name", count: 50, pct: 77 }],
          closings: [{ value: "none", count: 59, pct: 91 }],
          avgSentenceLen: 14,
          wordCountMedian: 60,
          signaturePhrases: [],
        },
      },
    });
    const guidance = buildClosingGuidance({
      learnedProfile: profile,
      examples: [],
      relationshipType: "casual",
    });
    expect(guidance).toContain("does NOT write an explicit closing");
    expect(guidance).toContain("91%");
    expect(guidance).toContain("signature block");
  });

  it("surfaces the top closing when it's a real one", () => {
    // Former_student bucket — top closing "warmly" at 43%.
    const guidance = buildClosingGuidance({
      learnedProfile: mkProfile(),
      examples: [],
      relationshipType: "former_student",
    });
    expect(guidance).toContain('"Warmly,"');
    expect(guidance).toContain("43%");
  });

  it("returns empty when top closing is 'other'", () => {
    const profile = mkProfile({
      byRelationship: {
        ...mkProfile().byRelationship,
        former_student: {
          count: 10,
          greetings: [],
          closings: [{ value: "other", count: 8, pct: 80 }],
          avgSentenceLen: 14,
          wordCountMedian: 60,
          signaturePhrases: [],
        },
      },
    });
    expect(
      buildClosingGuidance({
        learnedProfile: profile,
        examples: [],
        relationshipType: "former_student",
      }),
    ).toBe("");
  });
});

describe("buildVoiceBlock — integration shape", () => {
  it("composes a realistic complete block end-to-end", () => {
    const profile = mkProfile();
    const examples: VoiceExampleResult[] = [
      mkExample({
        recipientName: "Marc Beban",
        sentAt: new Date("2026-05-20"),
        body: "Marc,\n\nLove this draft — Section 3 is exactly the framing I'd push.",
      }),
      mkExample({
        emailMessageId: "e2",
        recipientName: "Sarah Chen",
        sentAt: new Date("2026-05-12"),
        matchKind: "fallback",
        body: "Sarah,\n\nQuick yes — Tuesday works. Will send the deck before.",
      }),
    ];
    const block = buildVoiceBlock({
      learnedProfile: profile,
      examples,
      relationshipType: "former_student",
    });
    expect(block).not.toBeNull();
    if (!block) return; // type narrowing
    // Section headers present
    expect(block).toContain("How the user typically writes to former students");
    expect(block).toContain("EXAMPLE 1");
    expect(block).toContain("EXAMPLE 2");
    expect(block).toContain("Phrases the user never uses");
    // Bodies survive
    expect(block).toContain("Love this draft");
    expect(block).toContain("Quick yes — Tuesday works");
    // Fallback tagged
    expect(block).toContain("cross-type");
    // Not so long it's unreasonable for a system prompt (<10KB).
    expect(block.length).toBeLessThan(10000);
  });
});
