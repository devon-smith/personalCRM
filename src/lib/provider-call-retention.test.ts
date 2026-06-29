import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  cleanupProviderCallLogs,
  DEFAULT_PROVIDER_CALL_LOG_RETENTION_DAYS,
  readProviderCallRetentionDays,
  subtractDays,
} from "@/lib/provider-call-retention";

describe("provider-call retention", () => {
  it("uses a 180-day default retention window", () => {
    expect(readProviderCallRetentionDays({})).toBe(
      DEFAULT_PROVIDER_CALL_LOG_RETENTION_DAYS,
    );
  });

  it("reads valid deployment-specific retention values", () => {
    expect(
      readProviderCallRetentionDays({
        PROVIDER_CALL_LOG_RETENTION_DAYS: "365",
      }),
    ).toBe(365);
  });

  it("falls back for invalid or too-small values", () => {
    expect(
      readProviderCallRetentionDays({
        PROVIDER_CALL_LOG_RETENTION_DAYS: "nope",
      }),
    ).toBe(DEFAULT_PROVIDER_CALL_LOG_RETENTION_DAYS);
    expect(
      readProviderCallRetentionDays({
        PROVIDER_CALL_LOG_RETENTION_DAYS: "7",
      }),
    ).toBe(DEFAULT_PROVIDER_CALL_LOG_RETENTION_DAYS);
  });

  it("rounds fractional values down", () => {
    expect(
      readProviderCallRetentionDays({
        PROVIDER_CALL_LOG_RETENTION_DAYS: "90.9",
      }),
    ).toBe(90);
  });

  it("deletes rows older than the configured cutoff", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 12 });
    const prisma = {
      providerCallLog: { deleteMany },
    } as unknown as PrismaClient;
    const now = new Date("2026-06-29T12:00:00.000Z");

    const summary = await cleanupProviderCallLogs(prisma, now, {
      PROVIDER_CALL_LOG_RETENTION_DAYS: "90",
    });

    expect(summary).toEqual({
      deletedRows: 12,
      retentionDays: 90,
      cutoff: new Date("2026-03-31T12:00:00.000Z"),
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: new Date("2026-03-31T12:00:00.000Z") },
      },
    });
  });

  it("subtracts whole days from a reference time", () => {
    const now = new Date("2026-06-29T12:00:00.000Z");
    expect(subtractDays(now, 2).toISOString()).toBe(
      "2026-06-27T12:00:00.000Z",
    );
  });
});
