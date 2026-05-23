/**
 * Pure name-cleanup helpers shared by ingest paths and the one-off migration
 * script. No DB access — input is `{ name, email }`, output is the cleaned
 * name plus a list of which fixes were applied (for audit reporting).
 */

export type NameFix =
  | "trim"
  | "quotes"
  | "leading-symbols"
  | "last-first-reversal"
  | "email-as-name"
  | "inferred-from-email";

export interface CleanedName {
  name: string | null;
  fixes: NameFix[];
}

// Treat both ASCII " ' and the common smart-quote codepoints as quote-wrappers.
const QUOTE_WRAPPER_RE = /^[\s"'‘’“”«»]+|[\s"'‘’“”«»]+$/g;

// Leading symbols people prefix names with: bullets, arrows, asterisks.
// Intentionally narrow — we don't strip letters or numbers.
const LEADING_SYMBOL_RE = /^[\s*\-–—>•·~|+#@/\\]+/;

// Quick email-ish detector. Looser than RFC; we just want to spot when a name
// field has been stuffed with an address.
const LOOKS_LIKE_EMAIL_RE = /^\S+@\S+\.\S+$/;

const LAST_FIRST_RE = /^([^,]+?)\s*,\s*([^,]+?)$/;

const ACADEMIC_SUFFIX_RE = /,?\s*(phd|md|mba|cfa|cpa|esq|dds|dvm|jr\.?|sr\.?|ii|iii|iv)\s*$/i;

/**
 * Clean a contact name, optionally rescuing from the email local-part if the
 * name is empty or itself looks like an email. Returns `null` if no usable
 * name can be derived (caller can choose to skip or keep the contact).
 */
export function cleanContactName(input: {
  name: string | null | undefined;
  email?: string | null | undefined;
}): CleanedName {
  const fixes: NameFix[] = [];
  let raw = (input.name ?? "").trim();

  // If name is empty, try to infer from email local-part.
  if (!raw) {
    const fromEmail = inferFromEmail(input.email);
    if (fromEmail) {
      fixes.push("inferred-from-email");
      return { name: fromEmail, fixes };
    }
    return { name: null, fixes };
  }

  // Outer cleanup loop: leading-symbol and quote strips can expose each
  // other (`* "Chen, Marcus"` strips `* ` then `"`...`"`). Run until stable.
  let prev = "";
  while (prev !== raw) {
    prev = raw;
    const desymbolled = raw.replace(LEADING_SYMBOL_RE, "");
    if (desymbolled !== raw) {
      if (!fixes.includes("leading-symbols")) fixes.push("leading-symbols");
      raw = desymbolled;
    }
    const dequoted = raw.replace(QUOTE_WRAPPER_RE, "");
    if (dequoted !== raw) {
      if (!fixes.includes("quotes")) fixes.push("quotes");
      raw = dequoted;
    }
  }

  // Strip academic suffixes (PhD, MBA, ...).
  const desuffixed = raw.replace(ACADEMIC_SUFFIX_RE, "").trim();
  if (desuffixed !== raw) {
    if (!fixes.includes("trim")) fixes.push("trim");
    raw = desuffixed;
  }

  // Re-run quote strip after suffix removal in case the suffix carried a quote.
  const post = raw.replace(QUOTE_WRAPPER_RE, "");
  if (post !== raw) {
    if (!fixes.includes("quotes")) fixes.push("quotes");
    raw = post;
  }

  // If the field is itself an email, prefer the explicit email field when
  // provided (better data source). Otherwise rescue from the name-as-email.
  if (LOOKS_LIKE_EMAIL_RE.test(raw)) {
    let replacement: string | null = null;
    if (input.email && input.email !== raw) {
      replacement = inferFromEmail(input.email);
    }
    if (!replacement) {
      const inferred = inferFromEmail(raw);
      if (inferred && inferred.toLowerCase() !== raw.toLowerCase()) {
        replacement = inferred;
      }
    }
    if (replacement) {
      fixes.push("email-as-name");
      raw = replacement;
    }
  }

  // "Last, First" → "First Last". Only fires when there's exactly one comma
  // and both halves look like name tokens (no numbers, no @).
  const reversed = raw.match(LAST_FIRST_RE);
  if (reversed) {
    const last = reversed[1].trim();
    const first = reversed[2].trim();
    if (isNameToken(first) && isNameToken(last)) {
      fixes.push("last-first-reversal");
      raw = `${first} ${last}`;
    }
  }

  // Collapse internal whitespace.
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed !== raw) {
    if (!fixes.includes("trim")) fixes.push("trim");
    raw = collapsed;
  }

  // Final trim-fix bookkeeping: if the trimmed-from-original differs from
  // input.name verbatim, flag it.
  if (raw !== (input.name ?? "") && !fixes.includes("trim") && fixes.length > 0) {
    // No-op — meaningful fix already flagged.
  } else if (raw !== (input.name ?? "") && fixes.length === 0) {
    fixes.push("trim");
  }

  return { name: raw || null, fixes };
}

function isNameToken(s: string): boolean {
  // Reject anything containing @, digits, or absurd length.
  if (!s) return false;
  if (s.length > 60) return false;
  if (/[@\d]/.test(s)) return false;
  return /[A-Za-zÀ-ɏ]/.test(s);
}

/**
 * Infer a display name from an email like "marcus.chen+work@stanford.edu".
 * Returns "Marcus Chen". Returns null when the local-part is non-name-like
 * (random hex, single character, all digits).
 */
export function inferFromEmail(email?: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return null;
  let local = email.slice(0, at);

  // Drop "+tag" suffix Gmail/etc use for filtering.
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);

  // Split on dot / underscore / hyphen.
  const parts = local
    .split(/[._\-]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return null;

  // Reject all-numeric, single-letter, hex-looking locals.
  const hasLetter = parts.some((p) => /[A-Za-z]/.test(p));
  if (!hasLetter) return null;
  if (parts.length === 1 && parts[0].length < 2) return null;
  if (parts.length === 1 && /^[0-9a-f]{12,}$/i.test(parts[0])) return null;

  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}
