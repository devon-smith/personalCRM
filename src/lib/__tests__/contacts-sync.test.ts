import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@/test/helpers";
import { prisma } from "@/lib/prisma";
import { fetchGoogleContacts } from "@/lib/gmail/contacts-import";

vi.mock("@/lib/gmail/client", () => ({
  getAllGoogleAccessTokens: vi.fn(),
  googleFetchWithToken: vi.fn(
    (_token: string, url: string, init?: RequestInit) => fetch(url, init),
  ),
}));

const { getAllGoogleAccessTokens } = await import("@/lib/gmail/client");

interface MockFetchCall {
  url: string;
  init?: RequestInit;
}

describe("fetchGoogleContacts — sync token lifecycle", () => {
  let calls: MockFetchCall[];
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    calls = [];
    vi.mocked(getAllGoogleAccessTokens).mockResolvedValue([
      { accountId: "acct-1", token: "TOK" },
    ]);

    // @ts-expect-error — Prisma is mocked via @/test/helpers; we wire what we need.
    prisma.contactsSyncCursor = {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    };
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.clearAllMocks();
  });

  it("first sync passes requestSyncToken=true and persists the returned token", async () => {
    // No cursor exists yet.
    vi.mocked(prisma.contactsSyncCursor.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.contactsSyncCursor.upsert).mockResolvedValue({} as never);

    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push({ url });
      return new Response(
        JSON.stringify({
          connections: [
            { names: [{ displayName: "Marcus Chen" }], emailAddresses: [{ value: "marcus@x.com" }] },
          ],
          nextSyncToken: "TOKEN-FRESH",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as never;

    const result = await fetchGoogleContacts("user-1");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Marcus Chen");
    expect(calls[0].url).toContain("requestSyncToken=true");
    expect(calls[0].url).not.toContain("syncToken=");

    expect(prisma.contactsSyncCursor.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = vi.mocked(prisma.contactsSyncCursor.upsert).mock.calls[0][0];
    expect(upsertCall.create.nextSyncToken).toBe("TOKEN-FRESH");
    expect(upsertCall.create.lastFullSyncAt).toBeInstanceOf(Date);
  });

  it("subsequent sync sends saved syncToken and not requestSyncToken", async () => {
    vi.mocked(prisma.contactsSyncCursor.findUnique).mockResolvedValue({
      id: "cur-1",
      userId: "user-1",
      accountId: "acct-1",
      nextSyncToken: "TOKEN-EXISTING",
      lastSyncAt: new Date(),
      lastFullSyncAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(prisma.contactsSyncCursor.upsert).mockResolvedValue({} as never);

    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push({ url });
      return new Response(
        JSON.stringify({ connections: [], nextSyncToken: "TOKEN-ROTATED" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as never;

    await fetchGoogleContacts("user-1");

    expect(calls[0].url).toContain("syncToken=TOKEN-EXISTING");
    expect(calls[0].url).not.toContain("requestSyncToken");

    const upsertCall = vi.mocked(prisma.contactsSyncCursor.upsert).mock.calls[0][0];
    expect(upsertCall.update.nextSyncToken).toBe("TOKEN-ROTATED");
    expect(upsertCall.update.lastFullSyncAt).toBeUndefined();
  });

  it("on 410 (expired token), wipes cursor and re-runs full sync", async () => {
    vi.mocked(prisma.contactsSyncCursor.findUnique).mockResolvedValue({
      id: "cur-1",
      userId: "user-1",
      accountId: "acct-1",
      nextSyncToken: "TOKEN-DEAD",
      lastSyncAt: new Date(),
      lastFullSyncAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(prisma.contactsSyncCursor.upsert).mockResolvedValue({} as never);

    let callIndex = 0;
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push({ url });
      callIndex++;
      if (callIndex === 1) {
        // First call uses the dead token and 410s
        return new Response("Sync token expired", { status: 410 });
      }
      // Second call should be a fresh full sync
      return new Response(
        JSON.stringify({
          connections: [
            { names: [{ displayName: "Alice" }], emailAddresses: [{ value: "a@x.com" }] },
          ],
          nextSyncToken: "TOKEN-RECOVERED",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as never;

    const result = await fetchGoogleContacts("user-1");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alice");

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("syncToken=TOKEN-DEAD");
    expect(calls[1].url).toContain("requestSyncToken=true");

    const upsertCall = vi.mocked(prisma.contactsSyncCursor.upsert).mock.calls[0][0];
    expect(upsertCall.update.nextSyncToken).toBe("TOKEN-RECOVERED");
    expect(upsertCall.update.lastFullSyncAt).toBeInstanceOf(Date);
  });

  it("on 400 EXPIRED_SYNC_TOKEN, wipes cursor and re-runs full sync", async () => {
    vi.mocked(prisma.contactsSyncCursor.findUnique).mockResolvedValue({
      id: "cur-1",
      userId: "user-1",
      accountId: "acct-1",
      nextSyncToken: "TOKEN-DEAD",
      lastSyncAt: new Date(),
      lastFullSyncAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(prisma.contactsSyncCursor.upsert).mockResolvedValue({} as never);

    let callIndex = 0;
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push({ url });
      callIndex++;
      if (callIndex === 1) {
        return new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: "Sync token is expired. Clear local cache and retry call without the sync token.",
              status: "FAILED_PRECONDITION",
              details: [{ reason: "EXPIRED_SYNC_TOKEN" }],
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          connections: [
            { names: [{ displayName: "Recovered" }], emailAddresses: [{ value: "r@x.com" }] },
          ],
          nextSyncToken: "TOKEN-RECOVERED",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as never;

    const result = await fetchGoogleContacts("user-1");

    expect(result.map((c) => c.name)).toEqual(["Recovered"]);
    expect(calls[0].url).toContain("syncToken=TOKEN-DEAD");
    expect(calls[1].url).toContain("requestSyncToken=true");

    const upsertCall = vi.mocked(prisma.contactsSyncCursor.upsert).mock.calls[0][0];
    expect(upsertCall.update.nextSyncToken).toBe("TOKEN-RECOVERED");
    expect(upsertCall.update.lastFullSyncAt).toBeInstanceOf(Date);
  });

  it("paginates to the last page to capture nextSyncToken even past maxContacts", async () => {
    // Regression: previously the loop exited at maxContacts and never saw
    // the final page where Google emits nextSyncToken. For accounts with
    // more contacts than the limit, this meant every future sync was full.
    vi.mocked(prisma.contactsSyncCursor.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.contactsSyncCursor.upsert).mockResolvedValue({} as never);

    let pageIdx = 0;
    globalThis.fetch = vi.fn(async () => {
      calls.push({ url: "" });
      pageIdx++;
      // Three pages total. Final page sends nextSyncToken and no nextPageToken.
      if (pageIdx < 3) {
        return new Response(
          JSON.stringify({
            connections: Array.from({ length: 100 }, (_, i) => ({
              names: [{ displayName: `Person ${pageIdx}-${i}` }],
              emailAddresses: [{ value: `p${pageIdx}-${i}@x.com` }],
            })),
            nextPageToken: `page-${pageIdx + 1}`,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          connections: [
            { names: [{ displayName: "Final Person" }], emailAddresses: [{ value: "final@x.com" }] },
          ],
          nextSyncToken: "TOKEN-FROM-LAST-PAGE",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as never;

    // Pass maxContacts=50 — small enough that the OLD loop would have
    // exited after the first page and never seen the syncToken.
    await fetchGoogleContacts("user-1", 50);

    expect(calls.length).toBe(3);
    const upsertCall = vi.mocked(prisma.contactsSyncCursor.upsert).mock.calls[0][0];
    expect(upsertCall.create.nextSyncToken).toBe("TOKEN-FROM-LAST-PAGE");
  });

  it("skips persons marked metadata.deleted=true in incremental delta", async () => {
    vi.mocked(prisma.contactsSyncCursor.findUnique).mockResolvedValue({
      id: "cur-1",
      userId: "user-1",
      accountId: "acct-1",
      nextSyncToken: "TOKEN",
      lastSyncAt: new Date(),
      lastFullSyncAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(prisma.contactsSyncCursor.upsert).mockResolvedValue({} as never);

    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          connections: [
            { names: [{ displayName: "Active" }], emailAddresses: [{ value: "x@x.com" }] },
            { metadata: { deleted: true }, resourceName: "people/c1" },
            { names: [{ displayName: "Also Active" }], emailAddresses: [{ value: "y@x.com" }] },
          ],
          nextSyncToken: "TOKEN2",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as never;

    const result = await fetchGoogleContacts("user-1");

    expect(result.map((c) => c.name)).toEqual(["Active", "Also Active"]);
  });
});
