import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/helpers";

vi.mock("@/lib/provider-call-log", () => ({
  logProviderCall: vi.fn(),
}));

const { logProviderCall } = await import("@/lib/provider-call-log");
const { googleFetchWithToken } = await import("@/lib/gmail/client");

describe("googleFetchWithToken telemetry", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("logs successful provider calls with service metadata", async () => {
    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 201 })) as never;

    const res = await googleFetchWithToken(
      "token",
      "https://people.googleapis.com/v1/people/me/connections",
      undefined,
      {
        userId: "user-1",
        service: "people",
        operation: "people.connections.list",
        feature: "google_contacts_import",
        metadata: { mode: "full" },
      },
    );

    expect(res.status).toBe(201);
    expect(logProviderCall).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        provider: "google",
        service: "people",
        operation: "people.connections.list",
        feature: "google_contacts_import",
        status: "success",
        error: null,
        metadata: { mode: "full", httpStatus: 201 },
      }),
    );
  });

  it("logs HTTP failures without consuming the response body", async () => {
    globalThis.fetch = vi.fn(async () => new Response("Forbidden", { status: 403 })) as never;

    const res = await googleFetchWithToken(
      "token",
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      undefined,
      {
        userId: "user-1",
        service: "calendar",
        operation: "calendar.events.list",
        feature: "calendar_events_fetch",
      },
    );

    expect(await res.text()).toBe("Forbidden");
    expect(logProviderCall).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        service: "calendar",
        operation: "calendar.events.list",
        feature: "calendar_events_fetch",
        status: "error",
        error: "http_403",
        metadata: { httpStatus: 403 },
      }),
    );
  });

  it("logs network failures before rethrowing", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as never;

    await expect(
      googleFetchWithToken(
        "token",
        "https://oauth2.googleapis.com/token",
        undefined,
        {
          userId: "user-1",
          service: "oauth",
          operation: "oauth.token.refresh",
          feature: "google_token_refresh",
        },
      ),
    ).rejects.toThrow("network down");

    expect(logProviderCall).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        service: "oauth",
        operation: "oauth.token.refresh",
        feature: "google_token_refresh",
        status: "error",
        error: "network down",
      }),
    );
  });
});
