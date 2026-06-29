import { describe, expect, it } from "vitest";
import type { DuplicateGroup } from "@/lib/contact-duplicates";
import {
  removeDuplicateGroups,
  removeDuplicateGroupsFromMergeBootstrap,
  type DuplicateGroupsCacheData,
  type MergeBootstrapCacheData,
} from "@/lib/duplicate-groups-cache";

function group(key: string, contactCount: number): DuplicateGroup {
  return {
    key,
    normalizedName: key,
    matchType: "exact_name",
    contacts: Array.from({ length: contactCount }, (_, index) => ({
      id: `${key}-${index}`,
      name: `Contact ${index}`,
      email: null,
      phone: null,
      company: null,
      role: null,
      source: "MANUAL",
      tier: "ACQUAINTANCE",
      lastInteraction: null,
      interactionCount: index,
      createdAt: "2026-01-01T00:00:00.000Z",
    })),
  };
}

describe("removeDuplicateGroups", () => {
  it("removes resolved duplicate groups and recomputes counts", () => {
    const current: DuplicateGroupsCacheData = {
      groups: [group("name:a", 2), group("name:b", 4), group("name:c", 3)],
      totalGroups: 3,
      totalDuplicates: 6,
    };

    expect(removeDuplicateGroups(current, ["name:b"])).toEqual({
      groups: [current.groups[0], current.groups[2]],
      totalGroups: 2,
      totalDuplicates: 3,
    });
  });

  it("returns the current cache object when no group keys are provided", () => {
    const current: DuplicateGroupsCacheData = {
      groups: [group("name:a", 2)],
      totalGroups: 1,
      totalDuplicates: 1,
    };

    expect(removeDuplicateGroups(current, [])).toBe(current);
  });
});

describe("removeDuplicateGroupsFromMergeBootstrap", () => {
  it("updates the nested duplicate payload without dropping linkedIn review state", () => {
    const current: MergeBootstrapCacheData = {
      duplicates: {
        groups: [group("name:a", 2), group("name:b", 3)],
        totalGroups: 2,
        totalDuplicates: 3,
      },
      linkedInReview: { totalPending: 7 },
    };

    expect(removeDuplicateGroupsFromMergeBootstrap(current, ["name:a"])).toEqual({
      duplicates: {
        groups: [current.duplicates.groups[1]],
        totalGroups: 1,
        totalDuplicates: 2,
      },
      linkedInReview: { totalPending: 7 },
    });
  });
});
