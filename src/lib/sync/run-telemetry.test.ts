import { describe, expect, it } from "vitest";
import { classifySyncError } from "@/lib/sync/run-telemetry";

describe("classifySyncError", () => {
  it("classifies rate limits before generic provider errors", () => {
    expect(classifySyncError(new Error("Calendar API error: 429"))).toBe(
      "rate_limit",
    );
  });

  it("classifies auth and reconnect failures", () => {
    expect(classifySyncError(new Error("No valid Google access token"))).toBe(
      "auth",
    );
    expect(classifySyncError(new Error("Calendar access denied"))).toBe("auth");
  });

  it("classifies network and provider failures", () => {
    expect(classifySyncError(new Error("fetch failed: ECONNRESET"))).toBe(
      "network",
    );
    expect(classifySyncError(new Error("Gmail API error: 503"))).toBe(
      "provider",
    );
  });
});
