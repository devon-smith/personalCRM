/**
 * Statistical signature detection for the voice corpus (M6.1.1).
 *
 * The hand-rolled signature stripping in stripQuotedAndSignature only
 * catches RFC 3676 (-- on its own line) and a handful of mobile
 * trailers. Real-world signatures don't follow that convention —
 * Jennifer's footer block ("Jennifer Aaker | General Atlantic
 * Professor | Stanford GSB") has no delimiter at all, just lives at
 * the end of every email.
 *
 * Approach: for each email, take the last N lines of the (already
 * quoted-stripped) body. A line is a signature line iff it appears
 * verbatim in ≥30% of emails. Pure function — no DB, no LLM. The
 * detector runs once per indexing pass over the user's corpus.
 *
 * The result is a list of lines that get persisted onto
 * VoiceProfile.signatureLines and used by feature-extraction to cut
 * everything from the first matching line to end-of-body before
 * tokenizing.
 */

import { stripQuotedAndSignature } from "./feature-extraction";
import { normalizeLine } from "./normalize";

export interface DetectOptions {
  /** Fraction of emails a line must appear in to count as signature.
   *  Default 0.3 per the M6.1.1 spec — high enough to filter one-off
   *  closings, low enough to catch sigs that drift over time. */
  threshold?: number;
  /** How many lines from end-of-body to consider. Footers stretch
   *  beyond the 5 the plan suggested — affiliation lines, social
   *  links, disclaimers can total 10–12 lines for academics. */
  tailLines?: number;
  /** Minimum number of bodies required before detection runs. Below
   *  this we don't have enough signal — return empty rather than
   *  surface random noise as "signature." */
  minCorpusSize?: number;
}

export interface DetectionResult {
  /** Signature lines, sorted longest-first for deterministic
   *  display + cutting. */
  lines: string[];
  /** Number of emails analyzed. */
  corpusSize: number;
  /** Per-line frequency, surfaced for the dry-run preview so the
   *  user can eyeball "yes that's my sig" vs false positives. */
  frequencies: Array<{ line: string; count: number; pct: number }>;
}

// Skip lines that are noise — empty, single-char, or obviously
// dynamic (timestamps, dates) and so unlikely to recur verbatim
// across many emails anyway.
const TIMESTAMP_RE = /\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/;
const PURE_PUNCT_RE = /^[\s\p{P}\p{S}]+$/u;

function isCandidateLine(line: string): boolean {
  if (line.length < 3) return false;
  if (TIMESTAMP_RE.test(line)) return false;
  if (PURE_PUNCT_RE.test(line)) return false;
  return true;
}

/**
 * Extract the last `tailLines` non-trivial lines of a body, after
 * stripping quoted reply chains. Returning the tail (not the whole
 * body) keeps false-positives low — recurring sentences mid-body
 * aren't signatures, they're voice phrases (which is what we want
 * to keep).
 */
function tailCandidates(body: string, tailLines: number): string[] {
  // Re-use the existing quoted/sig-delimiter stripper so we don't
  // pick up signatures from quoted-reply chains. The output may
  // still contain Jennifer's footer (since it has no delimiter) —
  // that's what we're trying to detect.
  const cleaned = stripQuotedAndSignature(body);
  const lines = cleaned
    .split("\n")
    .map(normalizeLine)
    .filter(isCandidateLine);
  return lines.slice(-tailLines);
}

export function detectSignatureLines(
  bodies: ReadonlyArray<string>,
  options: DetectOptions = {},
): DetectionResult {
  // 0.20 catches recurring sig variants that don't quite hit 30% (e.g.,
  // markdown-bold variant A in 30% of corpus, plain variant B in 20%).
  // With the shared normalizeLine canonicalizing markdown emphasis +
  // URL defense wrapping, A and B collapse into one bucket and we'd
  // be over 30% anyway — but the lower floor protects against new
  // variants the canonicalizer doesn't yet handle.
  const threshold = options.threshold ?? 0.2;
  const tailLines = options.tailLines ?? 10;
  const minCorpusSize = options.minCorpusSize ?? 20;

  if (bodies.length < minCorpusSize) {
    return { lines: [], corpusSize: bodies.length, frequencies: [] };
  }

  const counts = new Map<string, number>();
  for (const body of bodies) {
    // Dedupe within an email — a sig line that appears twice in one
    // email (e.g., quoted twice) counts as one occurrence for the
    // cross-email frequency calculation.
    const seen = new Set(tailCandidates(body, tailLines));
    for (const line of seen) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }

  const minCount = Math.ceil(bodies.length * threshold);
  const detected: Array<{ line: string; count: number; pct: number }> = [];
  for (const [line, count] of counts) {
    if (count >= minCount) {
      detected.push({
        line,
        count,
        pct: Math.round((count / bodies.length) * 100),
      });
    }
  }

  // Sort: most frequent first (most diagnostic), break ties by
  // length desc so multi-line sigs strip in stable order.
  detected.sort((a, b) => b.count - a.count || b.line.length - a.line.length);

  return {
    lines: detected.map((d) => d.line),
    corpusSize: bodies.length,
    frequencies: detected,
  };
}

// `stripDetectedSignatures` lives in feature-extraction.ts (alongside
// the other body-cleanup helpers) to avoid a circular import — this
// file imports stripQuotedAndSignature from there.
