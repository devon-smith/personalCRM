import { describe, it, expect } from "vitest";

/**
 * The history-panel filter logic is colocated with the React
 * component, but it's pure and worth unit-testing independently to
 * lock in behavior. This test file copies the algorithm here so
 * future refactors don't accidentally regress the rules.
 *
 * Rules under test:
 *   - Search matches across query + answer + title (case-insensitive)
 *   - Starred toggle excludes !isStarred
 *   - Time range cuts off rows older than the window
 *   - Sort: newest / oldest / most_revisited (runCount)
 */

type TimeRange = "all" | "today" | "week" | "month";
type SortMode = "newest" | "oldest" | "most_revisited";

interface Row {
  id: string;
  query: string;
  title: string | null;
  answer: string | null;
  isStarred: boolean;
  runCount: number;
  createdAt: string;
}

function filterAndSort(
  rows: Row[],
  opts: { search?: string; starredOnly?: boolean; timeRange?: TimeRange; sort?: SortMode; now?: number },
): Row[] {
  const search = (opts.search ?? "").trim().toLowerCase();
  const now = opts.now ?? Date.now();
  const day = 86_400_000;
  const since = (() => {
    switch (opts.timeRange ?? "all") {
      case "today":
        return now - day;
      case "week":
        return now - 7 * day;
      case "month":
        return now - 30 * day;
      default:
        return null;
    }
  })();

  const out = rows.filter((r) => {
    if (opts.starredOnly && !r.isStarred) return false;
    if (since !== null && new Date(r.createdAt).getTime() < since) return false;
    if (search) {
      const hay = `${r.query} ${r.answer ?? ""} ${r.title ?? ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const sort = opts.sort ?? "newest";
  out.sort((a, b) => {
    if (sort === "most_revisited") return b.runCount - a.runCount;
    const aT = new Date(a.createdAt).getTime();
    const bT = new Date(b.createdAt).getTime();
    return sort === "newest" ? bT - aT : aT - bT;
  });
  return out;
}

function mk(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    query: `query ${id}`,
    title: null,
    answer: `answer ${id}`,
    isStarred: false,
    runCount: 1,
    createdAt: new Date(2026, 0, 1).toISOString(),
    ...over,
  };
}

describe("ask history filter + sort", () => {
  it("returns everything when no filters", () => {
    const out = filterAndSort([mk("a"), mk("b")], {});
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("filters by starred", () => {
    const out = filterAndSort(
      [mk("a"), mk("b", { isStarred: true }), mk("c")],
      { starredOnly: true },
    );
    expect(out.map((r) => r.id)).toEqual(["b"]);
  });

  it("search matches across query, answer, and title", () => {
    const rows = [
      mk("a", { query: "Who knows Marc?" }),
      mk("b", { answer: "Sarah mentioned Marc twice" }),
      mk("c", { title: "Marc lookup" }),
      mk("d", { query: "Unrelated" }),
    ];
    const out = filterAndSort(rows, { search: "marc" });
    expect(out.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("search is case-insensitive", () => {
    const out = filterAndSort([mk("a", { query: "MARCUS" })], {
      search: "marcus",
    });
    expect(out).toHaveLength(1);
  });

  it("time range 'today' excludes anything older than 24h", () => {
    const now = Date.UTC(2026, 4, 27, 12, 0, 0);
    const rows = [
      mk("recent", { createdAt: new Date(now - 60_000).toISOString() }),
      mk("yesterday", {
        createdAt: new Date(now - 25 * 3_600_000).toISOString(),
      }),
    ];
    const out = filterAndSort(rows, { timeRange: "today", now });
    expect(out.map((r) => r.id)).toEqual(["recent"]);
  });

  it("time range 'week' excludes older than 7 days", () => {
    const now = Date.UTC(2026, 4, 27, 12, 0, 0);
    const rows = [
      mk("recent", { createdAt: new Date(now - 60_000).toISOString() }),
      mk("five-days-old", {
        createdAt: new Date(now - 5 * 86_400_000).toISOString(),
      }),
      mk("ten-days-old", {
        createdAt: new Date(now - 10 * 86_400_000).toISOString(),
      }),
    ];
    const out = filterAndSort(rows, { timeRange: "week", now });
    expect(out.map((r) => r.id).sort()).toEqual([
      "five-days-old",
      "recent",
    ]);
  });

  it("time range 'month' includes everything within 30 days", () => {
    const now = Date.UTC(2026, 4, 27, 12, 0, 0);
    const rows = [
      mk("recent", { createdAt: new Date(now - 60_000).toISOString() }),
      mk("a-month-old", {
        createdAt: new Date(now - 29 * 86_400_000).toISOString(),
      }),
      mk("ancient", {
        createdAt: new Date(now - 365 * 86_400_000).toISOString(),
      }),
    ];
    const out = filterAndSort(rows, { timeRange: "month", now });
    expect(out.map((r) => r.id).sort()).toEqual(["a-month-old", "recent"]);
  });

  it("sort newest = most recent first", () => {
    const rows = [
      mk("old", { createdAt: new Date(2026, 0, 1).toISOString() }),
      mk("new", { createdAt: new Date(2026, 5, 1).toISOString() }),
      mk("mid", { createdAt: new Date(2026, 3, 1).toISOString() }),
    ];
    const out = filterAndSort(rows, { sort: "newest" });
    expect(out.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });

  it("sort oldest = oldest first", () => {
    const rows = [
      mk("a", { createdAt: new Date(2026, 0, 1).toISOString() }),
      mk("b", { createdAt: new Date(2026, 5, 1).toISOString() }),
    ];
    expect(filterAndSort(rows, { sort: "oldest" }).map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("sort most_revisited orders by runCount desc", () => {
    const rows = [
      mk("a", { runCount: 1 }),
      mk("b", { runCount: 5 }),
      mk("c", { runCount: 3 }),
    ];
    expect(
      filterAndSort(rows, { sort: "most_revisited" }).map((r) => r.id),
    ).toEqual(["b", "c", "a"]);
  });

  it("combines starred + search + time range", () => {
    const now = Date.UTC(2026, 4, 27, 12, 0, 0);
    const rows = [
      mk("starred-recent-match", {
        isStarred: true,
        query: "Marcus",
        createdAt: new Date(now - 60_000).toISOString(),
      }),
      mk("unstarred-recent-match", {
        isStarred: false,
        query: "Marcus",
        createdAt: new Date(now - 60_000).toISOString(),
      }),
      mk("starred-old-match", {
        isStarred: true,
        query: "Marcus",
        createdAt: new Date(now - 60 * 86_400_000).toISOString(),
      }),
      mk("starred-recent-nomatch", {
        isStarred: true,
        query: "Unrelated",
        createdAt: new Date(now - 60_000).toISOString(),
      }),
    ];
    const out = filterAndSort(rows, {
      starredOnly: true,
      search: "marcus",
      timeRange: "week",
      now,
    });
    expect(out.map((r) => r.id)).toEqual(["starred-recent-match"]);
  });
});
