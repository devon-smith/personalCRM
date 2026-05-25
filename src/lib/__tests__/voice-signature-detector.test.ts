import { describe, it, expect } from "vitest";
import { detectSignatureLines } from "@/lib/voice/signature-detector";
import { stripDetectedSignatures } from "@/lib/voice/feature-extraction";

// Realistic Jennifer-style footer block. The plan's smoking-gun
// fingerprint snapshot showed this exact line dominating 70/72
// casual-bucket emails.
const SIG_LINE_1 = "Jennifer Aaker | General Atlantic Professor | Stanford GSB";
const SIG_LINE_2 = "https://jenniferaaker.com";

function emailWithSig(body: string, includeSig: boolean = true): string {
  if (!includeSig) return body;
  return `${body}\n\n${SIG_LINE_1}\n${SIG_LINE_2}`;
}

describe("detectSignatureLines", () => {
  it("detects a line appearing in ≥30% of emails", () => {
    const bodies = [
      ...Array.from({ length: 25 }, (_, i) => emailWithSig(`Body ${i}`, true)),
      ...Array.from({ length: 5 }, (_, i) => emailWithSig(`Body ${i}`, false)),
    ];
    const result = detectSignatureLines(bodies);
    expect(result.lines).toContain(SIG_LINE_1);
    expect(result.lines).toContain(SIG_LINE_2);
    expect(result.frequencies[0].pct).toBeGreaterThanOrEqual(80);
  });

  it("does NOT detect a real voice phrase appearing in only 5%", () => {
    const phrase = "would love to know what you think";
    const bodies = [
      ...Array.from({ length: 2 }, () => emailWithSig(`I ${phrase} about this`)),
      ...Array.from({ length: 38 }, (_, i) => emailWithSig(`Different body ${i}`)),
    ];
    const result = detectSignatureLines(bodies);
    expect(result.lines).not.toContain(phrase);
    expect(result.lines).toContain(SIG_LINE_1);
  });

  it("returns empty when corpus is below minCorpusSize", () => {
    const bodies = Array.from({ length: 5 }, () => emailWithSig("Body"));
    const result = detectSignatureLines(bodies);
    expect(result.lines).toEqual([]);
    expect(result.corpusSize).toBe(5);
  });

  it("respects custom threshold", () => {
    // 6/20 = 30% — at default threshold, this is signature.
    // At threshold 0.5, it's not.
    const bodies = [
      ...Array.from({ length: 6 }, (_, i) => emailWithSig(`Body ${i}`, true)),
      ...Array.from({ length: 14 }, (_, i) => emailWithSig(`Body ${i}`, false)),
    ];
    expect(detectSignatureLines(bodies, { threshold: 0.3 }).lines).toContain(
      SIG_LINE_1,
    );
    expect(detectSignatureLines(bodies, { threshold: 0.5 }).lines).not.toContain(
      SIG_LINE_1,
    );
  });

  it("ignores timestamps and pure-punctuation lines", () => {
    const bodies = Array.from({ length: 25 }, () => {
      // Both noise lines appear in every email but should be skipped.
      return `Body content here\n\n3:42 PM\n----\n${SIG_LINE_1}`;
    });
    const result = detectSignatureLines(bodies);
    expect(result.lines).toContain(SIG_LINE_1);
    expect(result.lines).not.toContain("3:42 PM");
    expect(result.lines).not.toContain("----");
  });

  it("dedupes within a single email — twice in one body counts once", () => {
    // If a sig appears twice in 1 email and 0 times in 39 others,
    // it's still 1/40 = 2.5%, not signature.
    const bodies = [
      `Body\n\n${SIG_LINE_1}\n${SIG_LINE_1}`,
      ...Array.from({ length: 39 }, (_, i) => `Different ${i}`),
    ];
    const result = detectSignatureLines(bodies);
    expect(result.lines).not.toContain(SIG_LINE_1);
  });

  it("strips quoted reply chains before scanning the tail", () => {
    // If we naïvely took the last 10 lines, the bottom of every email
    // would be Marc's quoted reply text, not Jennifer's sig. Stripping
    // first means the tail is Jennifer's actual writing.
    const bodies = Array.from({ length: 25 }, (_, i) => {
      return `Hi Marc,\n\nReply ${i}\n\n${SIG_LINE_1}\n\nOn Mon wrote:\n> Marc original message that's the same every time`;
    });
    const result = detectSignatureLines(bodies);
    expect(result.lines).toContain(SIG_LINE_1);
    // The quoted line should NOT be detected — it's stripped before
    // tailing.
    expect(result.lines).not.toContain(
      "> Marc original message that's the same every time",
    );
  });

  it("sorts detected lines longest-first (within frequency ties)", () => {
    const shortSig = "Jennifer";
    const longSig = SIG_LINE_1;
    const bodies = Array.from({ length: 30 }, (_, i) => {
      return `Body ${i}\n\n${longSig}\n${shortSig}`;
    });
    const result = detectSignatureLines(bodies);
    // Same frequency → longest first.
    const longIdx = result.lines.indexOf(longSig);
    const shortIdx = result.lines.indexOf(shortSig);
    expect(longIdx).toBeLessThan(shortIdx);
  });

  it("surfaces full frequencies array for dry-run inspection", () => {
    const bodies = Array.from({ length: 30 }, (_, i) => emailWithSig(`Body ${i}`));
    const result = detectSignatureLines(bodies);
    expect(result.frequencies.length).toBeGreaterThan(0);
    expect(result.frequencies[0]).toHaveProperty("line");
    expect(result.frequencies[0]).toHaveProperty("count");
    expect(result.frequencies[0]).toHaveProperty("pct");
  });
});

describe("stripDetectedSignatures", () => {
  it("cuts from the first matching sig line to end-of-body", () => {
    const body = `Hi Marc,\n\nQuick note — looks great.\n\n${SIG_LINE_1}\n${SIG_LINE_2}`;
    const stripped = stripDetectedSignatures(body, [SIG_LINE_1, SIG_LINE_2]);
    expect(stripped).not.toContain(SIG_LINE_1);
    expect(stripped).not.toContain(SIG_LINE_2);
    expect(stripped).toContain("Quick note");
  });

  it("is a no-op when signatureLines is empty", () => {
    const body = `Hi\n\n${SIG_LINE_1}`;
    expect(stripDetectedSignatures(body, [])).toBe(body);
  });

  it("does NOT strip if the matching line is in the body's first half", () => {
    // A sig line accidentally appearing in body content shouldn't
    // truncate the email mid-thought.
    const body = `${SIG_LINE_1}\n\nThis is the actual content of the email which is several lines long and continues on past the false-positive sig match above\nMore content\nEven more content\nKeep going\nAnd more\nStill more body text`;
    const stripped = stripDetectedSignatures(body, [SIG_LINE_1]);
    expect(stripped).toBe(body);
  });

  it("is idempotent", () => {
    const body = `Hi\n\nBody content\n\n${SIG_LINE_1}`;
    const once = stripDetectedSignatures(body, [SIG_LINE_1]);
    const twice = stripDetectedSignatures(once, [SIG_LINE_1]);
    expect(twice).toBe(once);
  });

  it("preserves trailing punctuation in non-sig content", () => {
    const body = `Hi Marc,\n\nWhat do you think?\n\n${SIG_LINE_1}`;
    const stripped = stripDetectedSignatures(body, [SIG_LINE_1]);
    expect(stripped).toContain("What do you think?");
  });
});
