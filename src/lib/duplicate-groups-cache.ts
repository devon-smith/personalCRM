import type { DuplicateGroup } from "@/lib/contact-duplicates";

export interface DuplicateGroupsCacheData {
  groups: DuplicateGroup[];
  totalGroups: number;
  totalDuplicates: number;
}

export interface MergeBootstrapCacheData {
  duplicates: DuplicateGroupsCacheData;
  linkedInReview?: { totalPending: number };
}

function countDuplicateContacts(groups: DuplicateGroup[]): number {
  return groups.reduce(
    (sum, group) => sum + Math.max(0, group.contacts.length - 1),
    0,
  );
}

export function removeDuplicateGroups(
  current: DuplicateGroupsCacheData | undefined,
  groupKeys: Iterable<string>,
): DuplicateGroupsCacheData | undefined {
  if (!current) return current;

  const keys = new Set(groupKeys);
  if (keys.size === 0) return current;

  const groups = current.groups.filter((group) => !keys.has(group.key));
  return {
    ...current,
    groups,
    totalGroups: groups.length,
    totalDuplicates: countDuplicateContacts(groups),
  };
}

export function removeDuplicateGroupsFromMergeBootstrap(
  current: MergeBootstrapCacheData | undefined,
  groupKeys: Iterable<string>,
): MergeBootstrapCacheData | undefined {
  if (!current) return current;

  const duplicates = removeDuplicateGroups(current.duplicates, groupKeys);
  if (!duplicates || duplicates === current.duplicates) return current;

  return {
    ...current,
    duplicates,
  };
}
