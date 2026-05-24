import { describe, it, expect } from "vitest";
import {
  buildContactEmbedText,
  formatVectorLiteral,
} from "@/lib/search/embeddings";

describe("buildContactEmbedText", () => {
  it("includes name, role+company, and email when all present", () => {
    const text = buildContactEmbedText({
      name: "Marcus Chen",
      email: "marcus@stanford.edu",
      role: "Researcher",
      company: "Stanford",
    });
    expect(text).toBe(
      "Marcus Chen\nResearcher at Stanford\nmarcus@stanford.edu",
    );
  });

  it("drops empty fields cleanly", () => {
    const text = buildContactEmbedText({
      name: "Marcus Chen",
      email: null,
      role: null,
      company: null,
    });
    expect(text).toBe("Marcus Chen");
  });

  it("emits role alone when company is missing", () => {
    const text = buildContactEmbedText({
      name: "Marcus Chen",
      role: "Researcher",
      company: null,
    });
    expect(text).toBe("Marcus Chen\nResearcher");
  });

  it("includes location when present", () => {
    const text = buildContactEmbedText({
      name: "Marcus Chen",
      city: "Palo Alto",
      state: "CA",
      country: "USA",
    });
    expect(text).toBe("Marcus Chen\nBased in Palo Alto, CA, USA");
  });

  it("includes circles when present", () => {
    const text = buildContactEmbedText({
      name: "Marcus Chen",
      circleNames: ["Stanford GSB Alumni", "Coffee buddies"],
    });
    expect(text).toBe(
      "Marcus Chen\nCircles: Stanford GSB Alumni, Coffee buddies",
    );
  });

  it("omits circles section when array is empty", () => {
    const text = buildContactEmbedText({
      name: "Marcus Chen",
      circleNames: [],
    });
    expect(text).toBe("Marcus Chen");
  });
});

describe("formatVectorLiteral", () => {
  it("formats as pgvector text literal with no spaces", () => {
    expect(formatVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });

  it("preserves negative values", () => {
    expect(formatVectorLiteral([-0.5, 0.0, 0.5])).toBe("[-0.5,0,0.5]");
  });

  it("handles empty arrays", () => {
    expect(formatVectorLiteral([])).toBe("[]");
  });

  it("preserves precision for typical embedding floats", () => {
    const v = [0.123456789, -0.987654321, 1e-7];
    expect(formatVectorLiteral(v)).toBe("[0.123456789,-0.987654321,1e-7]");
  });
});
