import { describe, it, expect } from "vitest";
import "@/test/helpers"; // mocks @/lib/prisma so client.ts imports cleanly
import { classifyRefreshFailure } from "@/lib/gmail/client";

describe("classifyRefreshFailure", () => {
  it("classifies invalid_grant as terminal (needs reconsent)", () => {
    const result = classifyRefreshFailure(
      400,
      JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }),
    );
    expect(result.kind).toBe("terminal");
    expect(result.error).toBe("invalid_grant");
  });

  it("classifies invalid_client as terminal", () => {
    const result = classifyRefreshFailure(
      401,
      JSON.stringify({ error: "invalid_client" }),
    );
    expect(result.kind).toBe("terminal");
  });

  it("classifies 500 as transient", () => {
    const result = classifyRefreshFailure(500, "Internal Server Error");
    expect(result.kind).toBe("transient");
  });

  it("classifies 502/503/504 as transient", () => {
    expect(classifyRefreshFailure(502, "").kind).toBe("transient");
    expect(classifyRefreshFailure(503, "").kind).toBe("transient");
    expect(classifyRefreshFailure(504, "").kind).toBe("transient");
  });

  it("classifies 429 (rate limit) as transient", () => {
    const result = classifyRefreshFailure(429, JSON.stringify({ error: "rate_limit_exceeded" }));
    expect(result.kind).toBe("transient");
  });

  it("classifies unknown 4xx as terminal so we don't hammer Google", () => {
    const result = classifyRefreshFailure(403, "Forbidden");
    expect(result.kind).toBe("terminal");
  });

  it("preserves error code when body is JSON", () => {
    const result = classifyRefreshFailure(400, JSON.stringify({ error: "invalid_grant" }));
    expect(result.error).toBe("invalid_grant");
  });

  it("falls back to 'unknown' when body is not JSON", () => {
    const result = classifyRefreshFailure(500, "<html>Server Error</html>");
    expect(result.error).toBe("unknown");
  });

  it("includes status in result for logging", () => {
    const result = classifyRefreshFailure(503, "");
    expect(result.status).toBe(503);
  });
});
