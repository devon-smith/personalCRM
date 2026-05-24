import { describe, it, expect } from "vitest";
import { computeBreadthScore, classifyDrift } from "@/lib/circle-analytics";

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

describe("computeBreadthScore", () => {
  it("returns 0 for an empty circle", () => {
    expect(computeBreadthScore([])).toBe(0);
  });

  it("returns 100 when every contact has interacted in the last year", () => {
    const contacts = [
      { tier: "INNER_CIRCLE", lastInteraction: daysAgo(10) },
      { tier: "PROFESSIONAL", lastInteraction: daysAgo(100) },
      { tier: "ACQUAINTANCE", lastInteraction: daysAgo(300) },
    ];
    expect(computeBreadthScore(contacts)).toBe(100);
  });

  it("returns 0 when nobody has interacted in the last year", () => {
    const contacts = [
      { tier: "INNER_CIRCLE", lastInteraction: daysAgo(400) },
      { tier: "PROFESSIONAL", lastInteraction: null },
    ];
    expect(computeBreadthScore(contacts)).toBe(0);
  });

  it("weights Inner Circle 3x over Acquaintance", () => {
    // 1 inner circle alive (weight 3), 1 acquaintance alive (weight 1) of
    // 1 inner circle alive (3) and 1 inner circle dead (3) and 1 acq alive (1):
    // active = 3 + 1 = 4, total = 3 + 3 + 1 = 7 → 57.
    const contacts = [
      { tier: "INNER_CIRCLE", lastInteraction: daysAgo(10) },
      { tier: "INNER_CIRCLE", lastInteraction: daysAgo(400) },
      { tier: "ACQUAINTANCE", lastInteraction: daysAgo(10) },
    ];
    expect(computeBreadthScore(contacts)).toBe(57);
  });

  it("treats null lastInteraction as never-active", () => {
    const contacts = [
      { tier: "PROFESSIONAL", lastInteraction: null },
      { tier: "PROFESSIONAL", lastInteraction: daysAgo(10) },
    ];
    expect(computeBreadthScore(contacts)).toBe(50);
  });
});

describe("classifyDrift", () => {
  it("flags drift when recent rate drops >50% vs baseline", () => {
    // Prior 60 days: 12 interactions = 0.2/day
    // Recent 30 days: 1 interaction = 0.033/day
    // ratio: 0.033/0.2 = 0.165 → drifting (under 0.5)
    const r = classifyDrift(1, 12);
    expect(r.drifting).toBe(true);
    expect(r.magnitude).toBeGreaterThan(0.8);
  });

  it("does NOT flag drift when recent rate is stable", () => {
    // Prior 60 days: 12 (0.2/day), Recent 30 days: 6 (0.2/day) → stable
    const r = classifyDrift(6, 12);
    expect(r.drifting).toBe(false);
    expect(r.magnitude).toBe(0);
  });

  it("does NOT flag drift on tiny baselines", () => {
    // Prior 60 days: 3 (0.05/day, under the 0.1 floor) → ignored
    const r = classifyDrift(0, 3);
    expect(r.drifting).toBe(false);
  });

  it("does NOT flag drift when recent rate is just below 50% of prior", () => {
    // Prior: 12/60 = 0.2/day. Recent: 4/30 = 0.133. Ratio 0.66 → not drift.
    const r = classifyDrift(4, 12);
    expect(r.drifting).toBe(false);
  });

  it("flags drift when recent count is exactly zero against a healthy baseline", () => {
    const r = classifyDrift(0, 18);
    expect(r.drifting).toBe(true);
    expect(r.magnitude).toBe(1);
  });

  it("magnitude is capped at 1.0", () => {
    const r = classifyDrift(0, 100);
    expect(r.magnitude).toBe(1);
  });
});
