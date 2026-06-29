import type { QueryClient } from "@tanstack/react-query";

interface SavedQueryCacheRow {
  id: string;
  query?: string;
  title?: string | null;
  answer?: string | null;
  evidence?: unknown;
  isStarred: boolean;
  runCount?: number;
  createdAt?: string;
  lastRunAt?: string | null;
  parentQueryId?: string | null;
  followUpCount?: number;
}

interface SavedQueriesHistoryCache<T extends SavedQueryCacheRow = SavedQueryCacheRow> {
  queries: T[];
}

interface SavedQueryDetailCache<T extends SavedQueryCacheRow = SavedQueryCacheRow> {
  savedQuery: T;
  followUps?: unknown;
}

interface SavedQueriesCountCache {
  count: number;
}

export interface SavedQueryCacheInsert {
  id: string;
  query: string;
  title: string | null;
  answer: string | null;
  evidence: unknown;
  isStarred?: boolean;
  runCount?: number;
  createdAt?: string;
  lastRunAt?: string | null;
  parentQueryId?: string | null;
  followUpCount?: number;
}

export interface SavedQueryCacheSnapshot {
  history?: SavedQueriesHistoryCache;
  detail?: SavedQueryDetailCache;
  count?: SavedQueriesCountCache;
}

function toCacheRow(input: SavedQueryCacheInsert): SavedQueryCacheRow {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    id: input.id,
    query: input.query,
    title: input.title,
    answer: input.answer,
    evidence: input.evidence,
    isStarred: input.isStarred ?? false,
    runCount: input.runCount ?? 1,
    createdAt,
    lastRunAt: input.lastRunAt ?? createdAt,
    parentQueryId: input.parentQueryId ?? null,
    followUpCount: input.followUpCount ?? 0,
  };
}

export function snapshotSavedQueryCaches(
  queryClient: QueryClient,
  id: string,
): SavedQueryCacheSnapshot {
  return {
    history: queryClient.getQueryData<SavedQueriesHistoryCache>([
      "saved-queries-history",
    ]),
    detail: queryClient.getQueryData<SavedQueryDetailCache>([
      "saved-query",
      id,
    ]),
    count: queryClient.getQueryData<SavedQueriesCountCache>([
      "saved-queries",
    ]),
  };
}

export function restoreSavedQueryCaches(
  queryClient: QueryClient,
  id: string,
  snapshot: SavedQueryCacheSnapshot | undefined,
) {
  if (!snapshot) return;
  if (snapshot.history) {
    queryClient.setQueryData(["saved-queries-history"], snapshot.history);
  }
  if (snapshot.detail) {
    queryClient.setQueryData(["saved-query", id], snapshot.detail);
  }
  if (snapshot.count) {
    queryClient.setQueryData(["saved-queries"], snapshot.count);
  }
}

export function setSavedQueryStar(
  queryClient: QueryClient,
  id: string,
  isStarred: boolean,
) {
  queryClient.setQueryData<SavedQueriesHistoryCache>(
    ["saved-queries-history"],
    (current) => current
      ? {
          queries: current.queries.map((query) =>
            query.id === id ? { ...query, isStarred } : query,
          ),
        }
      : current,
  );

  queryClient.setQueryData<SavedQueryDetailCache>(
    ["saved-query", id],
    (current) => current
      ? {
          ...current,
          savedQuery: { ...current.savedQuery, isStarred },
        }
      : current,
  );
}

export function seedSavedQueryDetailCache(
  queryClient: QueryClient,
  input: SavedQueryCacheInsert,
) {
  const savedQuery = toCacheRow(input);
  queryClient.setQueryData<SavedQueryDetailCache>(
    ["saved-query", input.id],
    (current) => current
      ? { ...current, savedQuery: { ...current.savedQuery, ...savedQuery } }
      : { savedQuery, followUps: [] },
  );
}

export function addSavedQueryToListCaches(
  queryClient: QueryClient,
  input: SavedQueryCacheInsert,
) {
  const row = toCacheRow(input);
  let shouldIncrementCount = true;

  queryClient.setQueryData<SavedQueriesHistoryCache>(
    ["saved-queries-history"],
    (current) => {
      if (!current) return current;
      if (current.queries.some((query) => query.id === row.id)) {
        shouldIncrementCount = false;
        return current;
      }
      return { queries: [row, ...current.queries] };
    },
  );

  queryClient.setQueryData<SavedQueriesCountCache>(
    ["saved-queries"],
    (current) => current
      ? { count: shouldIncrementCount ? current.count + 1 : current.count }
      : current,
  );
}

export function appendSavedQueryFollowUpCache(
  queryClient: QueryClient,
  parentId: string,
  input: SavedQueryCacheInsert,
) {
  const row = toCacheRow({ ...input, parentQueryId: parentId });
  let insertedIntoParent = false;

  queryClient.setQueryData<SavedQueryDetailCache>(
    ["saved-query", parentId],
    (current) => {
      if (!current) return current;
      const followUps = Array.isArray(current.followUps)
        ? current.followUps
        : [];
      if (followUps.some((item) =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        item.id === row.id
      )) {
        return current;
      }
      insertedIntoParent = true;
      return {
        ...current,
        savedQuery: {
          ...current.savedQuery,
          followUpCount: (current.savedQuery.followUpCount ?? 0) + 1,
        },
        followUps: [...followUps, row],
      };
    },
  );

  if (!insertedIntoParent) return;

  queryClient.setQueryData<SavedQueriesHistoryCache>(
    ["saved-queries-history"],
    (current) => current
      ? {
          queries: current.queries.map((query) =>
            query.id === parentId
              ? { ...query, followUpCount: (query.followUpCount ?? 0) + 1 }
              : query,
          ),
        }
      : current,
  );
}

export function removeSavedQueryFromListCaches(
  queryClient: QueryClient,
  id: string,
) {
  queryClient.setQueryData<SavedQueriesHistoryCache>(
    ["saved-queries-history"],
    (current) => {
      if (!current) return current;
      const queries = current.queries.filter((query) => query.id !== id);
      return { queries };
    },
  );

  queryClient.setQueryData<SavedQueriesCountCache>(
    ["saved-queries"],
    (current) => current
      ? { count: Math.max(0, current.count - 1) }
      : current,
  );
}

export function removeSavedQueryDetailCache(
  queryClient: QueryClient,
  id: string,
) {
  queryClient.removeQueries({ queryKey: ["saved-query", id], exact: true });
}
