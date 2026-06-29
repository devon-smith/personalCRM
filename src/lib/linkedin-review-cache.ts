export interface LinkedInReviewCacheItem {
  id: string;
  category: "job_change" | "name_match" | "partial_match";
}

export interface LinkedInReviewCacheData<T extends LinkedInReviewCacheItem> {
  items: T[];
  totalPending: number;
  summary: {
    jobChanges: number;
    nameMatches: number;
    partialMatches: number;
  };
}

export function removeLinkedInReviewItems<T extends LinkedInReviewCacheItem>(
  current: LinkedInReviewCacheData<T> | undefined,
  resolvedIds: Iterable<string>,
): LinkedInReviewCacheData<T> | undefined {
  if (!current) return current;

  const resolved = new Set(resolvedIds);
  if (resolved.size === 0) return current;

  const items = current.items.filter((item) => !resolved.has(item.id));
  return {
    ...current,
    items,
    totalPending: items.length,
    summary: {
      jobChanges: items.filter((item) => item.category === "job_change").length,
      nameMatches: items.filter((item) => item.category === "name_match").length,
      partialMatches: items.filter((item) => item.category === "partial_match").length,
    },
  };
}
