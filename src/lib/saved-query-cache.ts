import type { QueryClient } from "@tanstack/react-query";

interface SavedQueryCacheRow {
  id: string;
  isStarred: boolean;
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

export interface SavedQueryCacheSnapshot {
  history?: SavedQueriesHistoryCache;
  detail?: SavedQueryDetailCache;
  count?: SavedQueriesCountCache;
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

export function removeSavedQueryFromListCaches(
  queryClient: QueryClient,
  id: string,
) {
  let removedFromHistory = false;
  queryClient.setQueryData<SavedQueriesHistoryCache>(
    ["saved-queries-history"],
    (current) => {
      if (!current) return current;
      const queries = current.queries.filter((query) => query.id !== id);
      removedFromHistory = queries.length !== current.queries.length;
      return { queries };
    },
  );

  if (removedFromHistory) {
    queryClient.setQueryData<SavedQueriesCountCache>(
      ["saved-queries"],
      (current) => current
        ? { count: Math.max(0, current.count - 1) }
        : current,
    );
  }
}

export function removeSavedQueryDetailCache(
  queryClient: QueryClient,
  id: string,
) {
  queryClient.removeQueries({ queryKey: ["saved-query", id], exact: true });
}
