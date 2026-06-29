import { afterEach, describe, expect, it, vi } from "vitest";
import { getSyncRuntimeStatus } from "./runtime-status";

function mockPrisma() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    syncRun: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe("getSyncRuntimeStatus", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps browser fallback sync disabled by default", async () => {
    const status = await getSyncRuntimeStatus(mockPrisma() as never, "user-1");

    expect(status.browserSync).toEqual({
      mode: "disabled",
      reason: "Browser fallback is opt-in; worker/manual sync own freshness.",
    });
  });

  it("enables browser fallback sync only with the explicit public flag", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_BROWSER_SYNC", "true");

    const status = await getSyncRuntimeStatus(mockPrisma() as never, "user-1");

    expect(status.browserSync).toEqual({
      mode: "enabled",
      reason: "Explicitly enabled by NEXT_PUBLIC_ENABLE_BROWSER_SYNC.",
    });
  });

  it("lets the force-disable flag override the enable flag", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_BROWSER_SYNC", "true");
    vi.stubEnv("NEXT_PUBLIC_DISABLE_BROWSER_SYNC", "true");

    const status = await getSyncRuntimeStatus(mockPrisma() as never, "user-1");

    expect(status.browserSync).toEqual({
      mode: "disabled",
      reason: "Force-disabled by NEXT_PUBLIC_DISABLE_BROWSER_SYNC.",
    });
  });
});
