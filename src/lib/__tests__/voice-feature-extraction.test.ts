import { describe, it, expect } from "vitest";
import {
  stripQuotedAndSignature,
  detectOpening,
  detectClosing,
  wordCount,
  avgSentenceLen,
  candidateNgrams,
  extractFeatures,
} from "@/lib/voice/feature-extraction";

describe("stripQuotedAndSignature", () => {
  it("strips Gmail-style 'On <date>, <name> wrote:' quoted text", () => {
    const body = `Marc,

Thanks for sending. I'll take a look this weekend.

Warmly,
Jennifer

On Tue, May 13, 2026 at 9:14 AM, Marc Beban <marc@example.com> wrote:
> Hi Jennifer, attaching the deck for review.
> Let me know what you think.`;
    const cleaned = stripQuotedAndSignature(body);
    expect(cleaned).not.toContain("attaching the deck");
    expect(cleaned).not.toContain("On Tue");
    expect(cleaned).toContain("Thanks for sending");
  });

  it("strips RFC 3676 signature block (-- on its own line)", () => {
    const body = `Hey,

Quick reply — yes, count me in.

Warmly,
J

--
Jennifer Aaker
Stanford GSB
+1-650-555-0100`;
    const cleaned = stripQuotedAndSignature(body);
    expect(cleaned).not.toContain("Stanford GSB");
    expect(cleaned).not.toContain("650-555");
    expect(cleaned).toContain("count me in");
  });

  it("strips Outlook 8+ underscore reply separator", () => {
    const body = `Sounds good.

Best,
Jennifer
________________________________
From: Someone <s@example.com>
Subject: Re: thing`;
    const cleaned = stripQuotedAndSignature(body);
    expect(cleaned).not.toContain("From: Someone");
    expect(cleaned).toContain("Sounds good");
  });

  it("strips '> ' quoted reply lines", () => {
    const body = `Yes, agreed.

> Original message text here
> spanning multiple lines
> with quote markers`;
    const cleaned = stripQuotedAndSignature(body);
    expect(cleaned).toBe("Yes, agreed.");
  });

  it("strips mobile signature trailers", () => {
    const body = `Quick yes, will follow up Monday.

Sent from my iPhone`;
    const cleaned = stripQuotedAndSignature(body);
    expect(cleaned).not.toContain("iPhone");
    expect(cleaned).toContain("Quick yes");
  });

  it("strips forwarded-message headers", () => {
    const body = `FYI — see below.

---------- Forwarded message ---------
From: Someone
Subject: Old subject`;
    const cleaned = stripQuotedAndSignature(body);
    expect(cleaned).not.toContain("Forwarded");
    expect(cleaned).toContain("FYI");
  });

  it("leaves a clean body untouched", () => {
    const body = "Marc,\n\nQuick check-in. How's the launch going?\n\nWarmly,\nJ";
    const cleaned = stripQuotedAndSignature(body);
    expect(cleaned).toBe(body);
  });
});

describe("detectOpening", () => {
  it("returns 'first_name' for plain first-name salutations", () => {
    expect(detectOpening("Marc,\n\nFollowing up.")).toBe("first_name");
    expect(detectOpening("Marc!\n\nFollowing up.")).toBe("first_name");
  });

  it("returns 'first_name' for 'Hi Marc,' / 'Dear Marc,'", () => {
    expect(detectOpening("Hi Marc,\n\nFollowing up.")).toBe("first_name");
    expect(detectOpening("Dear Marc,\n\nFollowing up.")).toBe("first_name");
    expect(detectOpening("Hey Marc,\n\nFollowing up.")).toBe("first_name");
  });

  it("returns the bare-greeting variant when there's no name", () => {
    expect(detectOpening("Hi,\n\nFollowing up.")).toBe("hi");
    expect(detectOpening("Hey,\n\nFollowing up.")).toBe("hey");
    expect(detectOpening("Hello,\n\nFollowing up.")).toBe("hello");
    expect(detectOpening("Dear,\n\nFollowing up.")).toBe("dear");
  });

  it("returns 'none' when the body starts straight into content", () => {
    expect(detectOpening("Following up on the deck I sent last week.")).toBe(
      "none",
    );
  });

  it("returns 'none' for an empty body", () => {
    expect(detectOpening("")).toBe("none");
    expect(detectOpening("\n\n\n")).toBe("none");
  });
});

describe("detectClosing", () => {
  it("recognizes Jennifer's signature 'Warmly,'", () => {
    expect(detectClosing("Some content.\n\nWarmly,\nJennifer")).toBe("warmly");
  });

  it("recognizes 'Best,' / 'Best wishes,'", () => {
    expect(detectClosing("Some content.\n\nBest,\nJ")).toBe("best");
    expect(detectClosing("Some content.\n\nBest wishes,\nJ")).toBe("best");
    expect(detectClosing("Some content.\n\nAll the best,\nJ")).toBe("best");
  });

  it("recognizes 'Thanks!' / 'Thanks so much,'", () => {
    expect(detectClosing("OK!\n\nThanks!\nJ")).toBe("thanks");
    expect(detectClosing("OK!\n\nThanks so much,\nJ")).toBe("thanks");
  });

  it("recognizes 'Cheers' and 'Talk soon'", () => {
    expect(detectClosing("OK.\n\nCheers,\nJ")).toBe("cheers");
    expect(detectClosing("OK.\n\nTalk soon,\nJ")).toBe("talk_soon");
  });

  it("returns 'none' when the body lacks a closing line", () => {
    expect(detectClosing("Just one line response.")).toBe("none");
  });

  it("skips a likely-name last line to find the closing above", () => {
    expect(detectClosing("Body.\n\nWarmly,\nJennifer Aaker")).toBe("warmly");
  });
});

describe("wordCount", () => {
  it("counts plain words", () => {
    expect(wordCount("This is five words here.")).toBe(5);
  });

  it("treats URLs as a single token", () => {
    expect(wordCount("See https://example.com/very/long/path for details")).toBe(4);
  });

  it("treats email addresses as a single token", () => {
    // "Reach out to marc@example.com directly" — 5 tokens after URL+email
    // collapse: Reach / out / to / _email_ / directly.
    expect(wordCount("Reach out to marc@example.com directly")).toBe(5);
  });

  it("ignores punctuation-only tokens", () => {
    expect(wordCount("Yes ---- agreed!")).toBe(2);
  });
});

describe("avgSentenceLen", () => {
  it("computes mean words per sentence", () => {
    // Sentence 1: "Short one" → 2 words.
    // Sentence 2: "This sentence has six words total here" → 7 words.
    // Sentence 3: "Yes" → 1 word.
    const body = "Short one. This sentence has six words total here. Yes.";
    expect(avgSentenceLen(body)).toBeCloseTo((2 + 7 + 1) / 3, 1);
  });

  it("returns 0 for empty input", () => {
    expect(avgSentenceLen("")).toBe(0);
  });
});

describe("candidateNgrams", () => {
  it("emits 3-word phrases", () => {
    const ngrams = candidateNgrams("I would love to know what you think.");
    expect(ngrams).toContain("would love to");
  });

  it("filters out stock phrases like 'let me know'", () => {
    const ngrams = candidateNgrams("Please let me know your thoughts.");
    expect(ngrams).not.toContain("let me know");
  });

  it("does not straddle sentence boundaries", () => {
    const ngrams = candidateNgrams("Quick yes. Will follow up.");
    expect(ngrams).not.toContain("yes will follow");
  });
});

describe("extractFeatures — integration", () => {
  it("processes a realistic email end-to-end", () => {
    const body = `Marc,

Thanks for sending the draft over. I'd love to know what you think about the third section — that's where I have the most questions.

Quick suggestion: maybe consider pulling the conclusion forward? The Q&A piece is your strongest material.

Warmly,
Jennifer

On Mon, May 12, 2026 at 11:00 AM Marc <marc@example.com> wrote:
> Here's the draft we discussed.`;
    const features = extractFeatures(body);
    expect(features.opening).toBe("first_name");
    expect(features.closing).toBe("warmly");
    expect(features.wordCount).toBeGreaterThan(20);
    expect(features.wordCount).toBeLessThan(60);
    expect(features.avgSentenceLen).toBeGreaterThan(0);
    // Body says "I'd love to know" — apostrophes aren't stripped so the
    // tokens are ["i'd", "love", "to", "know", ...]. The 3-gram lives.
    expect(features.candidateNgrams).toContain("love to know");
    expect(features.cleanedBody).not.toContain("Here's the draft");
  });

  it("handles a terse one-liner", () => {
    const features = extractFeatures("Yes, sounds great. Talk soon.");
    expect(features.opening).toBe("none");
    expect(features.closing).toBe("talk_soon");
    expect(features.wordCount).toBeGreaterThan(0);
  });

  it("handles a body that starts mid-thought (no salutation)", () => {
    const features = extractFeatures(
      "Following up on our conversation about the new role. The timing feels right.",
    );
    expect(features.opening).toBe("none");
  });
});
