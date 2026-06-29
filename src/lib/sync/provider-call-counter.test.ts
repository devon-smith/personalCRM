import { describe, expect, it } from "vitest";
import {
  incrementProviderCall,
  withProviderCallCounter,
} from "@/lib/sync/provider-call-counter";

describe("provider call counter", () => {
  it("counts provider calls inside the active async context", async () => {
    const run = await withProviderCallCounter(async () => {
      incrementProviderCall("google");
      await Promise.resolve();
      incrementProviderCall("google");
      incrementProviderCall("voyage");
      return "done";
    });

    expect(run.result).toBe("done");
    expect(run.total).toBe(3);
    expect(run.counts).toEqual({ google: 2, voyage: 1 });
  });

  it("keeps concurrent run counts isolated", async () => {
    const [first, second] = await Promise.all([
      withProviderCallCounter(async () => {
        incrementProviderCall("google");
        await new Promise((resolve) => setTimeout(resolve, 5));
        incrementProviderCall("google");
      }),
      withProviderCallCounter(async () => {
        incrementProviderCall("google");
      }),
    ]);

    expect(first.counts.google).toBe(2);
    expect(first.total).toBe(2);
    expect(second.counts.google).toBe(1);
    expect(second.total).toBe(1);
  });
});
