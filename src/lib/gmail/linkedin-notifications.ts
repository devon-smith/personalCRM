/**
 * LinkedIn notification email parser.
 *
 * LinkedIn sends transactional emails from a handful of domains
 * (linkedin.com, messages-noreply.linkedin.com, news-noreply.linkedin.com,
 * jobalerts-noreply.linkedin.com) with structured subject lines that
 * surface relationship-relevant signals — primarily job changes.
 *
 * This parser is intentionally HIGH-PRECISION over recall: each pattern
 * only fires when the subject unambiguously names both the person and
 * either a new role or a new company. False positives create phantom
 * "job change" cards that erode trust faster than missing real ones.
 *
 * Returns null when nothing actionable parses. Caller decides how to
 * match the extracted name against the contact graph.
 */

export type LinkedInSignalKind = "job_change" | "promotion";

export interface LinkedInSignal {
  kind: LinkedInSignalKind;
  /** Person referenced in the subject — needs further name-matching by the caller. */
  name: string;
  /** New role/title if extracted. */
  newRole: string | null;
  /** New company if extracted. */
  newCompany: string | null;
}

const LINKEDIN_FROM_DOMAINS = [
  "linkedin.com",
  "messages-noreply.linkedin.com",
  "news-noreply.linkedin.com",
  "jobalerts-noreply.linkedin.com",
  "notifications-noreply.linkedin.com",
];

/** True when the email looks like it originated from LinkedIn. */
export function isLinkedInNotification(fromEmail: string | null | undefined): boolean {
  if (!fromEmail) return false;
  const at = fromEmail.toLowerCase().lastIndexOf("@");
  if (at < 0) return false;
  const domain = fromEmail.slice(at + 1).toLowerCase();
  return LINKEDIN_FROM_DOMAINS.some(
    (d) => domain === d || domain.endsWith(`.${d}`),
  );
}

// "[Name] started a new position as [Role] at [Company]"
const JOB_AS_AT_RE = /^(.{2,80}?)\s+(?:has\s+)?(?:started|begun)\s+(?:a\s+)?new\s+(?:position|role|job)\s+as\s+(.{2,80}?)\s+at\s+(.{2,80})$/i;

// "[Name] started a new position at [Company]" (no role given)
const JOB_AT_RE = /^(.{2,80}?)\s+(?:has\s+)?(?:started|begun)\s+(?:a\s+)?new\s+(?:position|role|job)\s+at\s+(.{2,80})$/i;

// "[Name] is now [Role] at [Company]"
const NOW_RE = /^(.{2,80}?)\s+is\s+now\s+(.{2,80}?)\s+at\s+(.{2,80})$/i;

// "[Name] was promoted to [Role]" — promotion (same company implied)
const PROMOTION_RE = /^(.{2,80}?)\s+(?:was|has\s+been)\s+promoted\s+to\s+(.{2,80})$/i;

// Ignore: anniversaries, connections, post shares.
const IGNORE_RE = /(anniversary|years? at|\bbirthday\b|shared (?:a|an) post|viewed your profile|invitation to connect|wants? to connect|new connection|reacted to|commented on|congratulate)/i;

/**
 * Parse a LinkedIn email subject for a job-change / promotion signal.
 * Returns null when nothing matches.
 */
export function parseLinkedInSubject(subject: string | null | undefined): LinkedInSignal | null {
  if (!subject) return null;
  const trimmed = subject.trim();
  if (!trimmed) return null;

  // Bail on subjects we explicitly don't want to treat as job signals,
  // even if they incidentally contain "X at Y" phrasing.
  if (IGNORE_RE.test(trimmed)) return null;

  const asAt = trimmed.match(JOB_AS_AT_RE);
  if (asAt) {
    return {
      kind: "job_change",
      name: cleanField(asAt[1]),
      newRole: cleanField(asAt[2]),
      newCompany: cleanField(asAt[3]),
    };
  }

  const at = trimmed.match(JOB_AT_RE);
  if (at) {
    return {
      kind: "job_change",
      name: cleanField(at[1]),
      newRole: null,
      newCompany: cleanField(at[2]),
    };
  }

  const now = trimmed.match(NOW_RE);
  if (now) {
    // "X is now Y at Z" is more ambiguous (could be a long-time role
    // being announced). Treat as job_change but flag conservatively.
    return {
      kind: "job_change",
      name: cleanField(now[1]),
      newRole: cleanField(now[2]),
      newCompany: cleanField(now[3]),
    };
  }

  const promo = trimmed.match(PROMOTION_RE);
  if (promo) {
    return {
      kind: "promotion",
      name: cleanField(promo[1]),
      newRole: cleanField(promo[2]),
      newCompany: null,
    };
  }

  return null;
}

function cleanField(s: string): string {
  // Strip trailing punctuation + quotes the patterns sometimes drag along.
  return s.replace(/[.,!?;:"'’\s]+$/, "").trim();
}
