import { describe, expect, it } from "vitest";
import {
  removeLinkedInReviewItems,
  type LinkedInReviewCacheData,
  type LinkedInReviewCacheItem,
} from "@/lib/linkedin-review-cache";

describe("removeLinkedInReviewItems", () => {
  it("removes resolved items and recomputes category counts", () => {
    const current: LinkedInReviewCacheData<LinkedInReviewCacheItem> = {
      items: [
        { id: "job", category: "job_change" },
        { id: "name", category: "name_match" },
        { id: "partial", category: "partial_match" },
      ],
      totalPending: 3,
      summary: { jobChanges: 1, nameMatches: 1, partialMatches: 1 },
    };

    const next = removeLinkedInReviewItems(current, ["job", "partial"]);

    expect(next?.items.map((item) => item.id)).toEqual(["name"]);
    expect(next?.totalPending).toBe(1);
    expect(next?.summary).toEqual({
      jobChanges: 0,
      nameMatches: 1,
      partialMatches: 0,
    });
  });

  it("preserves the cache when no resolved ids are provided", () => {
    const current: LinkedInReviewCacheData<LinkedInReviewCacheItem> = {
      items: [{ id: "job", category: "job_change" }],
      totalPending: 1,
      summary: { jobChanges: 1, nameMatches: 0, partialMatches: 0 },
    };

    expect(removeLinkedInReviewItems(current, [])).toBe(current);
  });
});
