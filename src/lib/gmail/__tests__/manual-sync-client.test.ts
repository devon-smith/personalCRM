import { afterEach, describe, expect, it, vi } from "vitest";
import { runManualGmailSync } from "@/lib/gmail/manual-sync-client";

describe("runManualGmailSync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips action extraction when sync has no content changes", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      processed: 0,
      changedThreads: [],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runManualGmailSync()).resolves.toMatchObject({
      processed: 0,
      contentChanged: false,
      scannedActions: false,
      actionsSaved: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends changed thread refs to action extraction", async () => {
    const changedThreads = [{ accountId: "account-1", threadId: "thread-1" }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ processed: 2, changedThreads }))
      .mockResolvedValueOnce(jsonResponse({ actionsSaved: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runManualGmailSync()).resolves.toMatchObject({
      processed: 2,
      contentChanged: true,
      scannedActions: true,
      actionsSaved: 1,
      changedThreads,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/gmail/extract-actions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ changedThreads }),
      }),
    );
  });

  it("does not call action extraction without changed thread refs", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      processed: 3,
      changedThreads: [],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runManualGmailSync()).resolves.toMatchObject({
      processed: 3,
      contentChanged: true,
      scannedActions: false,
      actionsSaved: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}
