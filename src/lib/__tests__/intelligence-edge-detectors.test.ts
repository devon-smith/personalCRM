import { describe, it, expect } from "vitest";
import {
  pairKey,
  unpairKey,
  scoreStrength,
  volumeStrengthFactor,
} from "@/lib/intelligence/edge-detectors/mutual-thread";
import {
  normalizeCompany,
  extractDomain,
  isPersonalDomain,
} from "@/lib/intelligence/edge-detectors/same-org";

describe("pairKey / unpairKey", () => {
  it("produces stable canonical ordering regardless of input order", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
    expect(pairKey("c1", "c2")).toBe("c1::c2");
    expect(pairKey("c2", "c1")).toBe("c1::c2");
  });

  it("round-trips through unpairKey", () => {
    const [a, b] = unpairKey(pairKey("abc-123", "xyz-456"));
    expect(a).toBe("abc-123");
    expect(b).toBe("xyz-456");
  });

  it("handles UUID-shaped IDs", () => {
    const id1 = "03cb3572-f2e9-414c-b7fa-345045a85bad";
    const id2 = "12cb3572-f2e9-414c-b7fa-345045a85bad";
    const key = pairKey(id1, id2);
    const [a, b] = unpairKey(key);
    expect(a).toBe(id1);
    expect(b).toBe(id2);
  });
});

describe("scoreStrength", () => {
  it("returns max strength for recent + many observations", () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    const score = scoreStrength(10, recent);
    expect(score).toBeGreaterThan(0.9);
  });

  it("decays for older threads", () => {
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    expect(scoreStrength(3, old)).toBeLessThan(scoreStrength(3, recent));
  });

  it("never drops below 0.3 floor for ancient threads", () => {
    const ancient = new Date(Date.now() - 1000 * 24 * 60 * 60 * 1000);
    const score = scoreStrength(5, ancient);
    expect(score).toBeGreaterThanOrEqual(0.3 * scoreStrength(5, new Date()));
  });

  it("counts diminishing returns (caps log-scale at 5 threads)", () => {
    const now = new Date();
    const oneShared = scoreStrength(1, now);
    const fiveShared = scoreStrength(5, now);
    const fiftyShared = scoreStrength(50, now);
    expect(fiveShared).toBeGreaterThan(oneShared);
    // 50 isn't massively more than 5 because of log scaling.
    expect(fiftyShared - fiveShared).toBeLessThan(0.2);
  });

  describe("volume signal (M0.8)", () => {
    it("downweights low-volume relationships when interactions are sparse", () => {
      const now = new Date();
      // Same pair count + recency, different interaction volume.
      const sparse = scoreStrength(3, now, 3); // 3 threads, 3 messages total
      const dense = scoreStrength(3, now, 60); // 3 threads, 60 messages total
      expect(dense).toBeGreaterThan(sparse);
    });

    it("rewards a single high-volume thread over multiple sparse ones", () => {
      const now = new Date();
      // One shared thread, 60 messages (deep relationship).
      const deepOne = scoreStrength(1, now, 60);
      // Five shared threads, 5 messages total (loose acquaintance).
      const wideThin = scoreStrength(5, now, 5);
      // We don't require deepOne > wideThin — count still matters —
      // but they should be in the same ballpark, not 2x apart like
      // they were before M0.8.
      const ratio = wideThin / deepOne;
      expect(ratio).toBeLessThan(1.6);
    });

    it("matches prior behavior when totalInteractions is omitted", () => {
      const now = new Date();
      const withoutVolume = scoreStrength(3, now);
      const withImplicit50 = scoreStrength(3, now, 50);
      // 50+ interactions → volume factor = 1.0, which is identical to
      // the omitted case (also 1.0). Same final score.
      expect(withoutVolume).toBeCloseTo(withImplicit50, 2);
    });
  });
});

describe("volumeStrengthFactor (M0.8)", () => {
  it("floors at 0.5 for zero or negative volume", () => {
    expect(volumeStrengthFactor(0)).toBeCloseTo(0.5, 2);
    expect(volumeStrengthFactor(-5)).toBeCloseTo(0.5, 2);
  });

  it("hits 1.0 at 50 interactions (caps from then on)", () => {
    expect(volumeStrengthFactor(50)).toBeCloseTo(1.0, 2);
    expect(volumeStrengthFactor(500)).toBeCloseTo(1.0, 2);
  });

  it("ramps monotonically between the floor and the cap", () => {
    expect(volumeStrengthFactor(1)).toBeLessThan(volumeStrengthFactor(10));
    expect(volumeStrengthFactor(10)).toBeLessThan(volumeStrengthFactor(25));
    expect(volumeStrengthFactor(25)).toBeLessThan(volumeStrengthFactor(50));
  });

  it("is bounded in [0.5, 1.0]", () => {
    for (const n of [0, 1, 3, 10, 25, 50, 100, 1000]) {
      const v = volumeStrengthFactor(n);
      expect(v).toBeGreaterThanOrEqual(0.5);
      expect(v).toBeLessThanOrEqual(1.0);
    }
  });
});

describe("normalizeCompany", () => {
  it("lowercases and trims", () => {
    expect(normalizeCompany("  Acme Corp  ")).toBe("acme");
  });

  it("strips legal suffixes for matching", () => {
    expect(normalizeCompany("Acme Inc")).toBe(normalizeCompany("Acme LLC"));
    expect(normalizeCompany("Stanford University")).toContain("stanford");
    expect(normalizeCompany("Foo Corporation")).toBe("foo");
  });

  it("returns null for null/empty input", () => {
    expect(normalizeCompany(null)).toBeNull();
    expect(normalizeCompany("")).toBeNull();
    expect(normalizeCompany(" ")).toBeNull();
  });

  it("returns null for single-char results after stripping", () => {
    expect(normalizeCompany("X.")).toBeNull(); // strips period, single char
  });
});

describe("extractDomain", () => {
  it("returns the domain after @", () => {
    expect(extractDomain("marc@stanford.edu")).toBe("stanford.edu");
    expect(extractDomain("foo+tag@example.com")).toBe("example.com");
  });

  it("handles uppercase + whitespace", () => {
    expect(extractDomain("Marc@Stanford.EDU")).toBe("stanford.edu");
  });

  it("returns null on bad input", () => {
    expect(extractDomain(null)).toBeNull();
    expect(extractDomain("not-an-email")).toBeNull();
    expect(extractDomain("")).toBeNull();
  });
});

describe("isPersonalDomain", () => {
  it("identifies known personal providers", () => {
    expect(isPersonalDomain("gmail.com")).toBe(true);
    expect(isPersonalDomain("Outlook.com")).toBe(true); // case-insensitive
    expect(isPersonalDomain("icloud.com")).toBe(true);
    expect(isPersonalDomain("proton.me")).toBe(true);
  });

  it("rejects work domains", () => {
    expect(isPersonalDomain("stanford.edu")).toBe(false);
    expect(isPersonalDomain("anthropic.com")).toBe(false);
    expect(isPersonalDomain("generalatlantic.com")).toBe(false);
  });
});
