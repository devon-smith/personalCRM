/**
 * Shared name normalization and matching utilities.
 * Used by the identity resolution engine and import routes.
 */

/**
 * Normalize a name for fuzzy matching:
 * - lowercase
 * - collapse whitespace
 * - strip common suffixes/prefixes
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a set of matching keys for a name.
 * Returns exact normalized + first-last swap.
 */
export function nameMatchKeys(name: string): string[] {
  const norm = normalizeName(name);
  const keys = [norm];

  const parts = norm.split(" ");
  if (parts.length === 2) {
    keys.push(`${parts[1]} ${parts[0]}`);
  }

  return keys;
}

/**
 * Normalize a phone number for matching.
 * Strips everything except digits and leading +.
 * E.g. "+1 (415) 555-1234" → "+14155551234"
 */
export function normalizePhone(phone: string): string {
  const stripped = phone.replace(/[^\d+]/g, "");
  // If it's a 10-digit US number without +1, add it
  if (/^\d{10}$/.test(stripped)) {
    return `+1${stripped}`;
  }
  return stripped;
}

/**
 * Normalize an email for matching.
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

// ─── Company normalization ──────────────────────────────────

const COMPANY_SUFFIXES = [
  "inc\\.", "inc", "incorporated",
  "llc", "l\\.l\\.c\\.",
  "ltd\\.", "ltd", "limited",
  "corp\\.", "corp", "corporation",
  "co\\.", "co",
  "company", "group", "holdings",
  "plc", "lp", "l\\.p\\.",
  "partners", "partner",
  "associates",
  "international", "intl",
  "technologies", "technology", "tech",
  "services", "solutions",
  "consulting", "consultants",
  "enterprises",
  "foundation",
  "university",
];

const COMPANY_SUFFIX_RE = new RegExp(
  `\\b(${COMPANY_SUFFIXES.join("|")}),?\\s*$`,
  "i",
);

/**
 * Normalize a company name for fuzzy matching:
 * - lowercase, trim
 * - strip "The " prefix
 * - strip trailing suffixes (Inc, LLC, Corp, etc.)
 * - strip trailing commas/periods
 * - collapse whitespace
 */
export function normalizeCompany(company: string): string {
  let result = company.toLowerCase().trim();

  // Strip "the " prefix
  if (result.startsWith("the ")) {
    result = result.slice(4);
  }

  // Strip common suffixes (may need multiple passes)
  for (let i = 0; i < 3; i++) {
    const before = result;
    result = result.replace(COMPANY_SUFFIX_RE, "").trim();
    result = result.replace(/[,.]$/, "").trim();
    if (result === before) break;
  }

  return result.replace(/\s+/g, " ").trim();
}

/**
 * Check if two normalized company names match using containment.
 * "goldman sachs" contains "goldman" → match
 * "goldman" is contained by "goldman sachs" → match
 */
export function companiesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

// ─── Name parsing ───────────────────────────────────────────

const NAME_SUFFIXES = /\b(jr\.?|sr\.?|ii|iii|iv|phd|md|esq\.?|dds|cpa)\b/gi;

/**
 * Parse a full name into first and last name parts.
 * Strips common suffixes like Jr, PhD, etc.
 */
export function parseFirstLast(fullName: string): { first: string; last: string } {
  const cleaned = fullName
    .replace(NAME_SUFFIXES, "")
    .replace(/\s+/g, " ")
    .trim();

  const parts = cleaned.split(" ");
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };

  return {
    first: parts[0],
    last: parts.slice(1).join(" "),
  };
}

/**
 * Normalize a LinkedIn profile URL for comparison.
 * Strips trailing slashes, query params, and locale prefixes.
 */
export function normalizeLinkedInUrl(url: string): string {
  let cleaned = url.toLowerCase().trim();
  // Remove protocol
  cleaned = cleaned.replace(/^https?:\/\//, "");
  // Remove www.
  cleaned = cleaned.replace(/^www\./, "");
  // Remove locale prefix like /in/
  cleaned = cleaned.replace(/^[a-z]{2}\.linkedin\.com/, "linkedin.com");
  // Remove query params and hash
  cleaned = cleaned.split("?")[0].split("#")[0];
  // Remove trailing slash
  cleaned = cleaned.replace(/\/+$/, "");
  return cleaned;
}
