import { describe, expect, it } from "vitest";
import {
  ERROR_RETENTION_DAYS,
  RUNNING_STALE_DAYS,
  SUCCESS_RETENTION_DAYS,
  subtractDays,
} from "@/lib/sync/run-retention";

describe("sync-run retention windows", () => {
  it("uses the intended retention cutoffs", () => {
    expect(SUCCESS_RETENTION_DAYS).toBe(90);
    expect(ERROR_RETENTION_DAYS).toBe(180);
    expect(RUNNING_STALE_DAYS).toBe(1);
  });

  it("subtracts whole days from a reference time", () => {
    const now = new Date("2026-06-29T12:00:00.000Z");
    expect(subtractDays(now, 2).toISOString()).toBe(
      "2026-06-27T12:00:00.000Z",
    );
  });
});
