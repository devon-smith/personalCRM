import { describe, it, expect } from "vitest";
import { combinedScore } from "@/lib/intelligence/graph-traverse";

describe("combinedScore", () => {
  it("returns full strength for very recent edges", () => {
    const now = new Date();
    expect(combinedScore(0.9, now)).toBeCloseTo(0.9, 2);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(combinedScore(0.9, yesterday)).toBeCloseTo(0.9, 2);
  });

  it("decays with time", () => {
    const month = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sixMonths = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const year = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    expect(combinedScore(0.9, month)).toBeGreaterThan(combinedScore(0.9, sixMonths));
    expect(combinedScore(0.9, sixMonths)).toBeGreaterThan(combinedScore(0.9, year));
  });

  it("floors at 0.2x for very old edges", () => {
    const ancient = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000);
    expect(combinedScore(1.0, ancient)).toBeCloseTo(0.2, 2);
  });

  it("respects edge strength as the multiplier", () => {
    const now = new Date();
    const strong = combinedScore(0.9, now);
    const weak = combinedScore(0.3, now);
    expect(strong / weak).toBeCloseTo(3, 1); // proportional
  });

  it("recent-weak can beat old-strong (the design intent)", () => {
    const now = new Date();
    const twoYears = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000);
    const recentWeak = combinedScore(0.5, now); // 0.5
    const oldStrong = combinedScore(1.0, twoYears); // 1.0 * 0.2 = 0.2
    expect(recentWeak).toBeGreaterThan(oldStrong);
  });
});
