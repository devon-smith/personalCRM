export interface SyncBudget {
  providerCallsPerDay: number;
  browserFallbackCallsPerDay: number;
  errorRatePercent: number;
}

export const DEFAULT_SYNC_BUDGET: SyncBudget = {
  providerCallsPerDay: 40,
  browserFallbackCallsPerDay: 4,
  errorRatePercent: 10,
};

export function readSyncBudget(
  env: Record<string, string | undefined> = process.env,
): SyncBudget {
  return {
    providerCallsPerDay: readBudgetNumber(
      env.SYNC_BUDGET_PROVIDER_CALLS_PER_DAY,
      DEFAULT_SYNC_BUDGET.providerCallsPerDay,
      { min: 1 },
    ),
    browserFallbackCallsPerDay: readBudgetNumber(
      env.SYNC_BUDGET_BROWSER_FALLBACK_CALLS_PER_DAY,
      DEFAULT_SYNC_BUDGET.browserFallbackCallsPerDay,
      { min: 0 },
    ),
    errorRatePercent: readBudgetNumber(
      env.SYNC_BUDGET_ERROR_RATE_PERCENT,
      DEFAULT_SYNC_BUDGET.errorRatePercent,
      { min: 1, max: 100 },
    ),
  };
}

function readBudgetNumber(
  raw: string | undefined,
  fallback: number,
  bounds: { min: number; max?: number },
): number {
  if (!raw?.trim()) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;

  const rounded = Math.floor(value);
  if (rounded < bounds.min) return fallback;
  if (bounds.max !== undefined && rounded > bounds.max) return fallback;
  return rounded;
}
