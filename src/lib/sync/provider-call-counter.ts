import { AsyncLocalStorage } from "node:async_hooks";

type ProviderCounts = Record<string, number>;

interface ProviderCallContext {
  counts: ProviderCounts;
}

const storage = new AsyncLocalStorage<ProviderCallContext>();

export async function withProviderCallCounter<T>(
  run: () => Promise<T>,
): Promise<{ result: T; counts: ProviderCounts; total: number }> {
  const context: ProviderCallContext = { counts: {} };
  const result = await storage.run(context, run);
  const counts = { ...context.counts };
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return { result, counts, total };
}

export function incrementProviderCall(provider: string): void {
  const context = storage.getStore();
  if (!context) return;
  context.counts[provider] = (context.counts[provider] ?? 0) + 1;
}
