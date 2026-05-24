/**
 * Affiliation-change detection helpers. Pure functions so the diff
 * decision is unit-testable; the worker task in
 * worker/tasks/openalex-affiliation-diff.ts wires them up to Prisma.
 *
 * Approach:
 *   - For each contact with openAlexAuthorId, refetch the OpenAlex
 *     author and read lastKnownInstitution.displayName.
 *   - Compare against Contact.lastSeenScholarlyInstitution.
 *   - If different (and the new value is non-null), produce a
 *     ContactChangelog of type COMPANY_CHANGE.
 *   - Update lastSeenScholarlyInstitution either way so we don't
 *     re-evaluate the same diff forever.
 */

export interface AffiliationDiffInput {
  /** Previous snapshot. Null on first run for this contact. */
  previous: string | null;
  /** Current value from OpenAlex. Null when OpenAlex has no institution
   *  on file (which we don't treat as a "change" — just no signal). */
  current: string | null;
}

export type AffiliationDiffResult =
  | { kind: "no_change"; current: string | null }
  | { kind: "initial_snapshot"; current: string }
  | { kind: "changed"; previous: string; current: string };

/**
 * Decide whether an affiliation change has happened.
 *
 * Rules:
 *  - current == null → no signal. Don't write anything; don't touch
 *    the snapshot. (Maybe the OpenAlex page hasn't been updated.)
 *  - previous == null + current != null → initial snapshot. Update
 *    the cache but don't write a changelog row (we don't know whether
 *    this is "new info" or just our first read).
 *  - previous != null + current != null + different → changed.
 *  - same string (case-insensitive trim) → no change.
 */
export function classifyAffiliation(input: AffiliationDiffInput): AffiliationDiffResult {
  const previous = normalize(input.previous);
  const current = normalize(input.current);

  if (!current) return { kind: "no_change", current: null };
  if (!previous) return { kind: "initial_snapshot", current };
  if (previous === current) return { kind: "no_change", current };
  return { kind: "changed", previous: input.previous!, current: input.current! };
}

function normalize(s: string | null): string {
  return (s ?? "").trim().toLowerCase();
}
