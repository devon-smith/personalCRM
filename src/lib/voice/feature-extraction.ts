/**
 * Deterministic feature extraction for the voice corpus (M6.1).
 *
 * Pure functions: given an email body, return structured features
 * (opening type, closing type, word count, avg sentence length,
 * candidate signature phrases). No LLM calls — keeps the per-email
 * cost at zero and lets Jennifer trust the signal.
 *
 * Aggregation across emails (frequencies, "never says" patterns) lives
 * in profile.ts; this file only handles single-email extraction.
 */

export interface ExtractedFeatures {
  opening: OpeningType;
  closing: ClosingType;
  wordCount: number;
  avgSentenceLen: number;
  /** Candidate 3-7 word n-grams from the cleaned body. The aggregator
   *  in profile.ts filters these down to phrases that recur ≥5 times. */
  candidateNgrams: string[];
  /** Body after stripping signature + quoted reply chain. Used by the
   *  embedding step so similarity is on what was actually written. */
  cleanedBody: string;
}

export type OpeningType =
  | "first_name"   // "Marc," / "Hi Marc," / "Dear Marc,"
  | "hi"           // "Hi,"
  | "hey"          // "Hey,"
  | "hello"        // "Hello,"
  | "dear"         // "Dear,"
  | "none"         // first line goes straight into content
  | "other";       // matches something we don't categorize

export type ClosingType =
  | "warmly"
  | "best"
  | "cheers"
  | "thanks"
  | "thank_you"
  | "sincerely"
  | "regards"
  | "talk_soon"
  | "xo"
  | "none"
  | "other";

// ─── Body cleanup ───────────────────────────────────────────

/**
 * Strip quoted reply chains, forwarded headers, and signature blocks
 * from an email body. Returns the body that Jennifer actually wrote.
 *
 * Heuristics:
 *   - Cut at "On <date>, <name> wrote:" — everything after is the quoted reply
 *   - Cut at lines starting with "> " (quoted text in plain reply)
 *   - Cut at "-- " on its own line (RFC 3676 signature delimiter)
 *   - Cut at "Sent from my iPhone" / "Get Outlook for iOS" style trailers
 *   - Cut at "________" (Outlook reply separator)
 */
export function stripQuotedAndSignature(body: string): string {
  let cleaned = body;

  // Outlook reply separator (8+ underscores).
  cleaned = cleaned.split(/\n_{8,}\n/)[0];

  // "On <date>, <name> wrote:" — Gmail's default quote header.
  cleaned = cleaned.split(/\n\s*On .{0,200}wrote:\s*\n/m)[0];

  // Forwarded header.
  cleaned = cleaned.split(/\n-{3,}\s*Forwarded message\s*-{3,}/)[0];

  // Signature delimiter per RFC 3676.
  cleaned = cleaned.split(/\n--\s*\n/)[0];

  // Trim quoted-reply lines (each starts with ">").
  cleaned = cleaned
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");

  // Mobile trailers — assume signature starts at the trailer line.
  cleaned = cleaned.split(/\n\s*(Sent from|Get Outlook|Sent via)\s/)[0];

  return cleaned.trim();
}

// ─── Opening detection ─────────────────────────────────────

const FIRST_NAME_RE = /^(hi|hello|hey|dear)?\s*([A-Z][a-z]+)[,:!]?\s*$/i;
const BARE_HI_RE = /^hi[,:!]?\s*$/i;
const BARE_HEY_RE = /^hey[,:!]?\s*$/i;
const BARE_HELLO_RE = /^hello[,:!]?\s*$/i;
const BARE_DEAR_RE = /^dear[,:!]?\s*$/i;

export function detectOpening(cleanedBody: string): OpeningType {
  const firstLine = (cleanedBody.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
  if (!firstLine) return "none";

  if (BARE_HI_RE.test(firstLine)) return "hi";
  if (BARE_HEY_RE.test(firstLine)) return "hey";
  if (BARE_HELLO_RE.test(firstLine)) return "hello";
  if (BARE_DEAR_RE.test(firstLine)) return "dear";

  // "Marc," / "Hi Marc," / "Dear Marc," — first_name family.
  if (FIRST_NAME_RE.test(firstLine)) return "first_name";

  // Content masquerading as a first line — salutations don't contain
  // sentence punctuation, and they're short. If we see either signal
  // strongly, treat as no opening rather than dumping into "other".
  const hasSentencePunctuation = /[.?!]/.test(firstLine);
  const wordCountFirstLine = firstLine.split(/\s+/).filter((t) => t.length > 0).length;
  if (firstLine.length > 40 || hasSentencePunctuation || wordCountFirstLine > 5) {
    return "none";
  }

  return "other";
}

// ─── Closing detection ─────────────────────────────────────

const CLOSING_PATTERNS: Array<[RegExp, ClosingType]> = [
  [/^warmly[,.!]?$/i, "warmly"],
  [/^best[,.!]?$/i, "best"],
  [/^best\s+(?:wishes|regards)[,.!]?$/i, "best"],
  [/^all\s+(the\s+)?best[,.!]?$/i, "best"],
  [/^cheers[,.!]?$/i, "cheers"],
  [/^thanks(?:\s+(?:so\s+much|again|a\s+ton|a\s+lot))?[,.!]?$/i, "thanks"],
  [/^thank\s+you[,.!]?$/i, "thank_you"],
  [/^sincerely[,.!]?$/i, "sincerely"],
  [/^(kind\s+)?regards[,.!]?$/i, "regards"],
  [/^(talk|speak)\s+(soon|later)[,.!]?$/i, "talk_soon"],
  [/^xo+[,.!]?$/i, "xo"],
];

export function detectClosing(cleanedBody: string): ClosingType {
  // Find the last non-empty line. If it looks like a name (just 1-3
  // capitalized words), peel it off and check the line above — that's
  // the closing.
  const lines = cleanedBody
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return "none";

  let candidateIdx = lines.length - 1;
  // Skip a likely-name last line. Names are 1–3 capitalized tokens, each
  // either a single initial ("J") or a normal word ("Jennifer Aaker").
  // Trailing period on initials ("J. A. Smith") allowed.
  const looksLikeName = /^([A-Z][a-z]*\.?\s?){1,3}$/.test(lines[candidateIdx]);
  if (looksLikeName && candidateIdx > 0) candidateIdx -= 1;

  const candidate = lines[candidateIdx];
  for (const [re, type] of CLOSING_PATTERNS) {
    if (re.test(candidate)) return type;
  }

  // Single-line messages like "Yes, sounds great. Talk soon." carry
  // the closing inside the last sentence. Re-check just the last
  // sentence against the patterns before bailing.
  const sentences = candidate
    .split(/[.?!]+\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length > 1) {
    const lastSentence = sentences[sentences.length - 1];
    for (const [re, type] of CLOSING_PATTERNS) {
      if (re.test(lastSentence)) return type;
    }
  }

  // Distinguish "no closing" from "weird closing." A closing is short
  // and has no sentence punctuation. Anything that looks like content
  // (ends in . ! ?, or has many words) is treated as no closing.
  const hasSentenceEnding = /[.?!]\s*$/.test(candidate);
  const wordCountCandidate = candidate.split(/\s+/).filter((t) => t.length > 0).length;
  if (candidate.length > 40 || hasSentenceEnding || wordCountCandidate > 4) {
    return "none";
  }
  return "other";
}

// ─── Word + sentence stats ─────────────────────────────────

/**
 * Count words in the cleaned body. URLs and email addresses count as
 * single tokens. Stricter than `split(/\s+/)` because we want a number
 * that maps to how much Jennifer actually wrote.
 */
export function wordCount(cleanedBody: string): number {
  // Replace URLs + emails with single placeholder tokens.
  const collapsed = cleanedBody
    .replace(/https?:\/\/\S+/g, "_url_")
    .replace(/\S+@\S+\.\S+/g, "_email_");
  const tokens = collapsed
    .split(/[\s\n]+/)
    .filter((t) => /[a-z0-9_]/i.test(t));
  return tokens.length;
}

/**
 * Average sentence length in words. Splits on . ! ? followed by
 * whitespace or EOL. Returns 0 if no sentence can be found.
 */
export function avgSentenceLen(cleanedBody: string): number {
  const sentences = cleanedBody
    .split(/[.!?]+(?=\s|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return 0;
  const total = sentences.reduce((sum, s) => sum + wordCount(s), 0);
  return Math.round((total / sentences.length) * 10) / 10;
}

// ─── Candidate n-grams ─────────────────────────────────────

/**
 * Stock phrases that show up in everyone's mail. We filter these out
 * so the signature-phrase aggregator doesn't surface them as Jennifer's
 * voice. List is intentionally short — only obvious universals.
 */
const STOCK_PHRASES = new Set([
  "let me know",
  "looking forward to",
  "thanks so much",
  "thank you for",
  "i hope this",
  "hope this finds",
  "hope this finds you",
  "i wanted to",
  "i would like",
  "please let me",
  "please let me know",
  "i'll be in",
  "i will be",
]);

/**
 * Extract 3-7 word n-grams from the cleaned body. The aggregator in
 * profile.ts counts cross-email frequencies and only retains phrases
 * appearing ≥5 times. We pre-filter stop phrases here to keep the
 * candidate set small.
 *
 * Returns lowercased n-grams. Sentence boundaries break n-grams (so
 * we don't generate phrases that straddle "I agree. Let me know").
 */
export function candidateNgrams(cleanedBody: string): string[] {
  const sentences = cleanedBody
    .split(/[.!?\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  const ngrams = new Set<string>();
  for (const sentence of sentences) {
    const tokens = sentence
      .replace(/[",;:()]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 0);
    for (let n = 3; n <= 7; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const phrase = tokens.slice(i, i + n).join(" ");
        if (STOCK_PHRASES.has(phrase)) continue;
        if (phrase.includes("_url_") || phrase.includes("_email_")) continue;
        ngrams.add(phrase);
      }
    }
  }
  return Array.from(ngrams);
}

// ─── Per-user detected signatures (M6.1.1) ─────────────────

/**
 * Strip per-user signature lines from a body. Cuts from the first
 * line that matches any sig line (in the back half of the body) to
 * end-of-body. Uses the shared `normalizeLine` from ./normalize so
 * the matching view is identical to what the detector sees.
 *
 * Lives here rather than in signature-detector.ts to avoid a circular
 * import — signature-detector consumes stripQuotedAndSignature above.
 */
import { normalizeLine as normalizeForMatch } from "./normalize";

export function stripDetectedSignatures(
  body: string,
  signatureLines: ReadonlyArray<string>,
): string {
  if (signatureLines.length === 0) return body;
  const sigSet = new Set(signatureLines);
  const lines = body.split("\n");

  // Find every sig match in the body. The original halfwayIdx guard
  // was wrong for reply-on-top layouts: when Jennifer writes a short
  // reply followed by a multi-line sig block, the sig name ends up in
  // the upper half of the post-quote-strip body. The guard skipped
  // it and left the sig leaking into n-grams (M6.1.1 round 3 bug).
  const matchIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (sigSet.has(normalizeForMatch(lines[i]))) {
      matchIndices.push(i);
    }
  }
  if (matchIndices.length === 0) return body;

  // Single-match safety: if only ONE line matches and it's short
  // (<20 chars), that's likely incidental body content — Jennifer's
  // sig has generic-looking lines like "Website" and "| linkedin"
  // that could plausibly appear in a body paragraph too. Two-line
  // matches are essentially impossible to false-positive on. A single
  // long match (the canonical "Jennifer Aaker | ..." line) is unique
  // enough to trust on its own.
  if (matchIndices.length === 1) {
    const matched = normalizeForMatch(lines[matchIndices[0]]);
    if (matched.length < 20) return body;
  }

  // Cut from the earliest match to end-of-body.
  return lines.slice(0, matchIndices[0]).join("\n").trimEnd();
}

// ─── Top-level extractor ───────────────────────────────────

/**
 * Extract voice features from an email body.
 *
 * @param body Raw email body as fetched from Gmail.
 * @param signatureLines Per-user signature lines from
 *   VoiceProfile.signatureLines (M6.1.1). Pass `[]` for the first-
 *   ever run when no signatures have been detected yet.
 *
 * Order matters: quote-stripping FIRST, then sig-stripping. The
 * detector in signature-detector.ts defines sig lines relative to the
 * post-quote-stripped tail of each email, so the stripper must operate
 * on the same view. Doing sig-strip first on the raw body had the back-
 * half heuristic look at the quoted-reply chain instead of Jennifer's
 * actual writing — sigs sat in the top half, the strip missed them,
 * and the fingerprint stayed dominated by footer fragments (M6.1.1 fix).
 */
export function extractFeatures(
  body: string,
  signatureLines: ReadonlyArray<string> = [],
): ExtractedFeatures {
  const quoteStripped = stripQuotedAndSignature(body);
  const cleanedBody = stripDetectedSignatures(quoteStripped, signatureLines);
  return {
    opening: detectOpening(cleanedBody),
    closing: detectClosing(cleanedBody),
    wordCount: wordCount(cleanedBody),
    avgSentenceLen: avgSentenceLen(cleanedBody),
    candidateNgrams: candidateNgrams(cleanedBody),
    cleanedBody,
  };
}
