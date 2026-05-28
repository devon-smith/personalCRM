import { describe, it, expect } from "vitest";
import { estimateCost, priceFor, featureLabel } from "@/lib/pricing";

describe("pricing.estimateCost (M0.x.14)", () => {
  it("computes Haiku cost correctly at 1M input + 1M output", () => {
    // Haiku 4.5: $1/M in, $5/M out → total $6
    const cost = estimateCost("claude-haiku-4-5-20251001", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(6, 5);
  });

  it("computes Sonnet cost correctly at 1M input + 1M output", () => {
    // Sonnet: $3/M in, $15/M out → total $18
    const cost = estimateCost("claude-sonnet-4-20250514", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(18, 5);
  });

  it("returns 0 for embedding-only Voyage call with no output", () => {
    // Voyage 3 Lite: $0.02/M in, $0/M out
    const cost = estimateCost("voyage-3-lite", 100_000, 0);
    expect(cost).toBeCloseTo(0.002, 5);
  });

  it("returns 0 for unknown models (flagged to render with 'unknown' label)", () => {
    const cost = estimateCost("totally-fake-model", 1_000_000, 1_000_000);
    expect(cost).toBe(0);
    expect(priceFor("totally-fake-model").label).toBe("Unknown model");
  });
});

describe("pricing.featureLabel (M0.x.14)", () => {
  it("returns friendly labels for known features", () => {
    expect(featureLabel("draft")).toBe("Draft generation");
    expect(featureLabel("inbox_classify")).toBe("Inbox classification");
    expect(featureLabel("life_event_extract")).toBe("Life-event extraction");
    expect(featureLabel("network_query")).toBe("Network queries (/ask)");
  });

  it("falls back to the raw feature key when unknown", () => {
    expect(featureLabel("some_future_feature")).toBe("some_future_feature");
  });
});
