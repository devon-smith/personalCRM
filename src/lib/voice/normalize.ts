/**
 * Canonical line normalization for the voice corpus (M6.1.1+).
 *
 * Used identically by the signature detector (deciding what's a sig)
 * and the per-email stripper (matching detected sigs in bodies). Both
 * must see lines through the same lens or detection finds something
 * the stripper can't match — which is exactly what happened on the
 * first rebuild: the same sig text appeared in three forms across
 * Jennifer's corpus (markdown-bold variants, URL-defense wrapping
 * differences) and the detector caught one form while the others
 * leaked into the fingerprint.
 *
 * Transformations:
 *   1. Strip Proofpoint URL-defense wrapping
 *      `<https://urldefense.com/v3/__https:/foo.com__;!!...>` → `https://foo.com`
 *      Click-tracking suffixes vary per email, so the wrapper makes
 *      otherwise-identical URLs look distinct.
 *   2. Strip markdown emphasis runs (`**`, `*`) — Jennifer's footer
 *      has random asterisks around `|` separators that vary across
 *      sends.
 *   3. Strip zero-width characters (ZWSP, BOM) — `\s` doesn't match
 *      these and they cause false mismatches that are invisible on
 *      inspection.
 *   4. Collapse all Unicode whitespace runs to single spaces, trim.
 *
 * Conservative: case is preserved (Jennifer uses consistent
 * capitalization; lowercasing would collapse legitimately-different
 * sigs and hurt more than help).
 */

const URL_DEFENSE_RE =
  /<?https?:\/\/urldefense\.(?:com|proofpoint\.com)\/v\d+\/__([^_]+?)__;[^>\s]*>?/g;

const ZERO_WIDTH_RE = /[​-‍﻿]/g;

export function normalizeLine(line: string): string {
  return line
    // (1) Unwrap URL defense. The inner URL stores `https:/` (single
    // slash); restore the canonical `https://`.
    .replace(URL_DEFENSE_RE, (_, inner: string) =>
      inner.replace(/^(https?):\/(?!\/)/, "$1://"),
    )
    // (2) Strip markdown emphasis runs of 1-3 asterisks. Order matters:
    // `**` before `*` so we don't leave orphaned asterisks behind.
    .replace(/\*{1,3}/g, "")
    // (3) Drop zero-width chars before whitespace collapse.
    .replace(ZERO_WIDTH_RE, "")
    // (4) Whitespace collapse + trim.
    .replace(/\s+/g, " ")
    .trim();
}
