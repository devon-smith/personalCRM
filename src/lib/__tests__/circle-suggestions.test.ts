import { describe, it, expect } from "vitest";
import { normalizeCompany, normalizeCity } from "@/lib/circle-suggestions";

describe("normalizeCompany (M0.x.14)", () => {
  it("strips common corporate suffixes", () => {
    expect(normalizeCompany("Anthropic Inc.")).toBe("anthropic");
    expect(normalizeCompany("Anthropic, Inc")).toBe("anthropic");
    expect(normalizeCompany("OpenEvidence LLC")).toBe("openevidence");
    expect(normalizeCompany("Acme Corp")).toBe("acme");
    expect(normalizeCompany("Foo Holdings")).toBe("foo");
  });

  it("clusters variants of the same company together", () => {
    const a = normalizeCompany("Anthropic");
    const b = normalizeCompany("Anthropic Inc.");
    const c = normalizeCompany("ANTHROPIC, INC");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("returns null for empty / one-char input", () => {
    expect(normalizeCompany("")).toBeNull();
    expect(normalizeCompany(null)).toBeNull();
    expect(normalizeCompany(undefined)).toBeNull();
    expect(normalizeCompany("a")).toBeNull();
    expect(normalizeCompany("  ")).toBeNull();
  });

  it("preserves multi-word companies (no aggressive trimming)", () => {
    expect(normalizeCompany("Stanford Graduate School of Business")).toBe(
      "stanford graduate school of business",
    );
    expect(normalizeCompany("New York Times")).toBe("new york times");
  });
});

describe("normalizeCity (M0.x.14)", () => {
  it("lowercases and trims", () => {
    expect(normalizeCity("San Francisco")).toBe("san francisco");
    expect(normalizeCity("  Palo Alto  ")).toBe("palo alto");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeCity("New   York")).toBe("new york");
  });

  it("returns null for empty / one-char input", () => {
    expect(normalizeCity("")).toBeNull();
    expect(normalizeCity(null)).toBeNull();
    expect(normalizeCity(undefined)).toBeNull();
    expect(normalizeCity("a")).toBeNull();
  });
});
