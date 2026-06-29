import { describe, expect, it } from "vitest";
import { DEFAULT_SYNC_BUDGET, readSyncBudget } from "./sync-budget";

describe("readSyncBudget", () => {
  it("uses defaults when no env values are set", () => {
    expect(readSyncBudget({})).toEqual(DEFAULT_SYNC_BUDGET);
  });

  it("reads valid deployment-specific budget values", () => {
    expect(
      readSyncBudget({
        SYNC_BUDGET_PROVIDER_CALLS_PER_DAY: "120",
        SYNC_BUDGET_BROWSER_FALLBACK_CALLS_PER_DAY: "0",
        SYNC_BUDGET_ERROR_RATE_PERCENT: "25",
      }),
    ).toEqual({
      providerCallsPerDay: 120,
      browserFallbackCallsPerDay: 0,
      errorRatePercent: 25,
    });
  });

  it("falls back for invalid or out-of-range values", () => {
    expect(
      readSyncBudget({
        SYNC_BUDGET_PROVIDER_CALLS_PER_DAY: "nope",
        SYNC_BUDGET_BROWSER_FALLBACK_CALLS_PER_DAY: "-1",
        SYNC_BUDGET_ERROR_RATE_PERCENT: "101",
      }),
    ).toEqual(DEFAULT_SYNC_BUDGET);
  });

  it("rounds fractional values down", () => {
    expect(
      readSyncBudget({
        SYNC_BUDGET_PROVIDER_CALLS_PER_DAY: "80.9",
        SYNC_BUDGET_BROWSER_FALLBACK_CALLS_PER_DAY: "2.7",
        SYNC_BUDGET_ERROR_RATE_PERCENT: "5.5",
      }),
    ).toEqual({
      providerCallsPerDay: 80,
      browserFallbackCallsPerDay: 2,
      errorRatePercent: 5,
    });
  });
});
