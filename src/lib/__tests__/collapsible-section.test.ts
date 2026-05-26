import { describe, it, expect, beforeEach } from "vitest";
import {
  shouldShowDisclosure,
  getVisibleItems,
  defaultShowMoreLabel,
  readSessionExpanded,
  _resetSessionExpandStateForTesting,
} from "@/components/ds/collapsible-section";

describe("shouldShowDisclosure", () => {
  it("returns true when total exceeds preview", () => {
    expect(shouldShowDisclosure(10, 5)).toBe(true);
  });

  it("returns false when total equals preview (no items hidden)", () => {
    expect(shouldShowDisclosure(5, 5)).toBe(false);
  });

  it("returns false when total is less than preview", () => {
    expect(shouldShowDisclosure(2, 5)).toBe(false);
  });

  it("returns false on zero items (never show disclosure on empty list)", () => {
    expect(shouldShowDisclosure(0, 5)).toBe(false);
  });
});

describe("getVisibleItems", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("returns first N when collapsed", () => {
    expect(getVisibleItems(items, 3, false)).toEqual([1, 2, 3]);
    expect(getVisibleItems(items, 5, false)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns all items when expanded", () => {
    expect(getVisibleItems(items, 3, true)).toEqual(items);
    expect(getVisibleItems(items, 0, true)).toEqual(items);
  });

  it("returns the full list when items.length <= previewCount, regardless of expand state", () => {
    const small = [1, 2];
    expect(getVisibleItems(small, 5, false)).toEqual(small);
    expect(getVisibleItems(small, 5, true)).toEqual(small);
  });

  it("does not mutate the input", () => {
    const input = [1, 2, 3];
    const out = getVisibleItems(input, 2, true);
    expect(out).not.toBe(input);
    expect(input).toEqual([1, 2, 3]);
  });

  it("handles empty input", () => {
    expect(getVisibleItems([], 5, false)).toEqual([]);
    expect(getVisibleItems([], 5, true)).toEqual([]);
  });
});

describe("defaultShowMoreLabel", () => {
  it("produces a plain '_Show N more_' string", () => {
    expect(defaultShowMoreLabel(12)).toBe("Show 12 more");
    expect(defaultShowMoreLabel(1)).toBe("Show 1 more");
    expect(defaultShowMoreLabel(0)).toBe("Show 0 more");
  });
});

describe("readSessionExpanded", () => {
  // Module-level singleton — clear between tests so they don't leak.
  beforeEach(() => {
    _resetSessionExpandStateForTesting();
  });

  it("returns false by default (fresh page load starts collapsed)", () => {
    expect(readSessionExpanded("any-key")).toBe(false);
  });

  it("different keys are independent", () => {
    // Both should default to false even after one is set elsewhere.
    expect(readSessionExpanded("dashboard-inbox-expanded")).toBe(false);
    expect(readSessionExpanded("dashboard-birthdays-expanded")).toBe(false);
  });

  it("survives a reset only when explicitly cleared", () => {
    // The session-scoped Map is cleared in beforeEach. Without that,
    // a prior test's toggle would leak — the reset hook is what
    // keeps the test suite deterministic.
    _resetSessionExpandStateForTesting();
    expect(readSessionExpanded("dashboard-birthdays-expanded")).toBe(false);
  });
});
