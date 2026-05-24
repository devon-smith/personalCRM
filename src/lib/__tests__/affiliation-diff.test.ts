import { describe, it, expect } from "vitest";
import { classifyAffiliation } from "@/lib/research/affiliation-diff";

describe("classifyAffiliation", () => {
  it("no_change when current is null", () => {
    const r = classifyAffiliation({ previous: "Stanford", current: null });
    expect(r.kind).toBe("no_change");
  });

  it("no_change when previous and current match", () => {
    const r = classifyAffiliation({
      previous: "Stanford University",
      current: "Stanford University",
    });
    expect(r.kind).toBe("no_change");
  });

  it("no_change when only differing in case/whitespace", () => {
    const r = classifyAffiliation({
      previous: "  Stanford University  ",
      current: "STANFORD UNIVERSITY",
    });
    expect(r.kind).toBe("no_change");
  });

  it("initial_snapshot when previous is null and current is set", () => {
    const r = classifyAffiliation({ previous: null, current: "Stanford University" });
    expect(r.kind).toBe("initial_snapshot");
    if (r.kind === "initial_snapshot") {
      expect(r.current).toBe("stanford university"); // normalized form
    }
  });

  it("changed when previous and current differ meaningfully", () => {
    const r = classifyAffiliation({
      previous: "Harvard University",
      current: "Stanford GSB",
    });
    expect(r.kind).toBe("changed");
    if (r.kind === "changed") {
      // Preserves original casing for the changelog row.
      expect(r.previous).toBe("Harvard University");
      expect(r.current).toBe("Stanford GSB");
    }
  });

  it("no_change when both null", () => {
    const r = classifyAffiliation({ previous: null, current: null });
    expect(r.kind).toBe("no_change");
  });
});
