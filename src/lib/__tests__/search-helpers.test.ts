import { describe, it, expect } from "vitest";
import "@/test/helpers";
import {
  generateTranspositionVariants,
  emailLocalToNameProbe,
} from "@/lib/search/contacts";

describe("generateTranspositionVariants", () => {
  it("generates 1 swap variant for 2-char input", () => {
    expect(generateTranspositionVariants("ab")).toEqual(["ab", "ba"]);
  });

  it("generates all adjacent swaps for 4-char query", () => {
    // 'mrac' → swaps at positions 0-1, 1-2, 2-3
    const v = generateTranspositionVariants("mrac");
    expect(v).toContain("mrac"); // original
    expect(v).toContain("rmac"); // swap pos 0-1
    expect(v).toContain("marc"); // swap pos 1-2 — the canonical typo fix
    expect(v).toContain("mrca"); // swap pos 2-3
    expect(v).toHaveLength(4);
  });

  it("dedupes when swap produces an identical string", () => {
    // 'aaa' → swap-pos-0 → 'aaa', swap-pos-1 → 'aaa'. Set dedupes.
    expect(generateTranspositionVariants("aaa")).toEqual(["aaa"]);
  });

  it("no-ops on single-char input", () => {
    expect(generateTranspositionVariants("a")).toEqual(["a"]);
  });

  it("expands to up to n unique variants (with dedup on adjacent repeats)", () => {
    // "hello" has 4 adjacent pairs but pos 2-3 swap is l↔l (same char,
    // dedupes to the original). Result: 4 uniques including the original.
    expect(generateTranspositionVariants("hello").length).toBe(4);
    // "helo" has no repeats so all 3 swaps produce distinct variants.
    expect(generateTranspositionVariants("helo").length).toBe(4);
  });
});

describe("emailLocalToNameProbe", () => {
  it("parses standard email local-part", () => {
    expect(emailLocalToNameProbe("marc.beban@gmail.com")).toBe("marc beban");
  });

  it("drops +tag suffix", () => {
    expect(emailLocalToNameProbe("marc.beban+work@gmail.com")).toBe("marc beban");
  });

  it("normalizes separators", () => {
    expect(emailLocalToNameProbe("j.doe-smith_x@example.com")).toBe("j doe smith x");
  });

  it("returns null for opaque numeric locals", () => {
    expect(emailLocalToNameProbe("12345@x.com")).toBeNull();
  });

  it("returns null for very short locals", () => {
    expect(emailLocalToNameProbe("a@x.com")).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(emailLocalToNameProbe("no-at-sign")).toBeNull();
    expect(emailLocalToNameProbe("@nolocal.com")).toBeNull();
  });
});
