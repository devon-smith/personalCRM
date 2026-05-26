import { describe, it, expect } from "vitest";
import { normalizeLine } from "@/lib/voice/normalize";

describe("normalizeLine", () => {
  it("collapses whitespace runs to a single space and trims", () => {
    expect(normalizeLine("  hello   world  ")).toBe("hello world");
    expect(normalizeLine("\t\nfoo\t\tbar\n")).toBe("foo bar");
  });

  it("strips markdown-bold (**) emphasis runs", () => {
    expect(normalizeLine("**hello**")).toBe("hello");
    expect(normalizeLine("**a** **b**")).toBe("a b");
  });

  it("strips single-asterisk (*) emphasis runs", () => {
    expect(normalizeLine("*hello*")).toBe("hello");
    expect(normalizeLine("*foo bar*")).toBe("foo bar");
  });

  it("collapses Variant A and Variant B of Jennifer's footer to identical strings", () => {
    // The actual variants from the M6.1.1 rebuild report.
    const variantA = "*Jennifer Aaker | General Atlantic Professor **| **Stanford GSB *";
    const variantB = "*Jennifer Aaker | General Atlantic Professor | Stanford GSB *";
    expect(normalizeLine(variantA)).toBe(normalizeLine(variantB));
    expect(normalizeLine(variantA)).toBe(
      "Jennifer Aaker | General Atlantic Professor | Stanford GSB",
    );
  });

  it("unwraps Proofpoint URL defense to the inner URL", () => {
    // Wrapped form Proofpoint uses — single-slash internally, then
    // restored to https:// canonical form.
    const wrapped =
      "<https://urldefense.com/v3/__https:/www.linkedin.com/in/jaaker/__;!!ABC123!somerandomstuff>";
    expect(normalizeLine(wrapped)).toBe("https://www.linkedin.com/in/jaaker/");
  });

  it("collapses different URL-defense wrappers of the same URL", () => {
    // Same underlying URL, two different click-tracking suffixes.
    const a =
      "<https://urldefense.com/v3/__https:/jaaker.people.stanford.edu/__;!!FIRST_ID!aaa>";
    const b =
      "<https://urldefense.com/v3/__https:/jaaker.people.stanford.edu/__;!!SECOND_ID!bbb>";
    expect(normalizeLine(a)).toBe(normalizeLine(b));
  });

  it("strips zero-width characters that whitespace regex misses", () => {
    // ZWSP between letters, BOM at start.
    const tricky = "﻿foo​bar";
    expect(normalizeLine(tricky)).toBe("foobar");
  });

  it("preserves case (intentional — see normalize.ts header)", () => {
    expect(normalizeLine("Best, Jennifer")).toBe("Best, Jennifer");
    expect(normalizeLine("BEST, JENNIFER")).toBe("BEST, JENNIFER");
    expect(normalizeLine("Best, Jennifer")).not.toBe(normalizeLine("best, jennifer"));
  });

  it("leaves plain text alone", () => {
    expect(normalizeLine("Jennifer Aaker | Stanford GSB")).toBe(
      "Jennifer Aaker | Stanford GSB",
    );
  });

  it("idempotent — running twice yields the same result", () => {
    const variant = "*Jennifer Aaker | General Atlantic Professor **| **Stanford GSB *";
    const once = normalizeLine(variant);
    const twice = normalizeLine(once);
    expect(twice).toBe(once);
  });
});
