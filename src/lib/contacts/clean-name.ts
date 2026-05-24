/**
 * Pure name-cleanup helpers shared by ingest paths and the one-off migration
 * script. No DB access — input is `{ name, email }`, output is the cleaned
 * name plus a list of which fixes were applied (for audit reporting).
 *
 * Design bias: when in doubt, leave the name alone. Better to skip a real
 * fix than to mangle a real name. False-positive mutations are what got
 * caught in dry-runs; this version expands the credential dictionary,
 * requires explicit comma boundaries for ambiguous credentials, and bails
 * Last/First reversal aggressively.
 */

export type NameFix =
  | "trim"
  | "quotes"
  | "leading-symbols"
  | "last-first-reversal"
  | "email-as-name"
  | "inferred-from-email"
  | "credentials";

export interface CleanedName {
  name: string | null;
  fixes: NameFix[];
}

// Treat both ASCII " ' and the common smart-quote codepoints as quote-wrappers.
const QUOTE_WRAPPER_RE = /^[\s"'‘’“”«»]+|[\s"'‘’“”«»]+$/g;

// Leading symbols people prefix names with: bullets, arrows, asterisks.
// Intentionally narrow — we don't strip letters or numbers.
const LEADING_SYMBOL_RE = /^[\s*\-–—>•·~|+#@/\\]+/;

const LOOKS_LIKE_EMAIL_RE = /^\S+@\S+\.\S+$/;

const LAST_FIRST_RE = /^([^,]+?)\s*,\s*([^,]+?)$/;

// All forms (with and without periods) we'll strip when comma-bounded.
const CREDENTIAL_WORDS = new Set<string>([
  // Academic degrees
  "phd", "ph.d", "ph.d.",
  "md", "m.d", "m.d.",
  "mba", "m.b.a", "m.b.a.",
  "ma", "m.a", "m.a.",
  "ms", "m.s", "m.s.",
  "msc", "m.sc", "m.sc.",
  "mph", "m.p.h", "m.p.h.",
  "mfa", "m.f.a", "m.f.a.",
  "jd", "j.d", "j.d.",
  "llm", "ll.m", "ll.m.",
  "edd", "ed.d", "ed.d.",
  "dds", "d.d.s", "d.d.s.",
  "dvm", "d.v.m", "d.v.m.",
  "rn", "r.n", "r.n.",
  "ba", "b.a", "b.a.",
  "bs", "b.s", "b.s.",
  "bsc", "b.sc", "b.sc.",
  // Professional certifications
  "cfa", "c.f.a", "c.f.a.",
  "cpa", "c.p.a", "c.p.a.",
  "esq", "esq.",
  "pmp", "mcc", "pcc", "cpcc", "acc",
  "phr", "sphr", "shrm-cp", "shrm-scp",
  "lcsw", "lpc", "lmft", "lmhc",
  // Generational
  "jr", "jr.", "sr", "sr.",
  "ii", "iii", "iv", "v",
]);

// Subset safe to strip on a whitespace-only boundary (no comma needed):
// degrees that are unambiguously credentials. Generational (Jr/Sr/IV) and
// short professional acronyms are NOT here — they need comma confirmation.
const ACADEMIC_ONLY = new Set<string>([
  "phd", "ph.d", "ph.d.",
  "md", "m.d", "m.d.",
  "mba", "m.b.a", "m.b.a.",
  "ma", "m.a", "m.a.",
  "ms", "m.s", "m.s.",
  "msc", "m.sc", "m.sc.",
  "mph", "m.p.h", "m.p.h.",
  "mfa", "m.f.a", "m.f.a.",
  "jd", "j.d", "j.d.",
  "llm", "ll.m", "ll.m.",
  "edd", "ed.d", "ed.d.",
  "dds", "d.d.s", "d.d.s.",
  "dvm", "d.v.m", "d.v.m.",
  "rn", "r.n", "r.n.",
  "ba", "b.a", "b.a.",
  "bs", "b.s", "b.s.",
  "bsc", "b.sc", "b.sc.",
  "cfa", "c.f.a", "c.f.a.",
  "cpa", "c.p.a", "c.p.a.",
  "esq", "esq.",
]);

/**
 * Clean a contact name. Returns `null` if no usable name can be derived
 * (caller can choose to skip or keep the contact).
 */
export function cleanContactName(input: {
  name: string | null | undefined;
  email?: string | null | undefined;
}): CleanedName {
  const fixes: NameFix[] = [];
  let raw = (input.name ?? "").trim();

  if (!raw) {
    const fromEmail = inferFromEmail(input.email);
    if (fromEmail) {
      fixes.push("inferred-from-email");
      return { name: fromEmail, fixes };
    }
    return { name: null, fixes };
  }

  // Symbol + quote strip loop. `* "Chen, Marcus"` requires removing the
  // leading `* ` before the quote-strip can see the wrapping `"`...`"`.
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

  // Strip trailing credentials past a comma boundary. Accepts any token
  // from CREDENTIAL_WORDS plus short all-caps and dot-style credentials.
  const afterTrailingCommaCreds = stripTrailingCredsAfterComma(raw);
  if (afterTrailingCommaCreds !== raw) {
    fixes.push("credentials");
    raw = afterTrailingCommaCreds;
  }

  // Strip trailing academic credentials on a whitespace boundary too —
  // restricted to the ACADEMIC_ONLY set so we don't eat names ending in
  // "IV", "Jr.", or random acronyms.
  const afterTrailingSpaceCreds = stripTrailingAcademicAfterSpace(raw);
  if (afterTrailingSpaceCreds !== raw) {
    if (!fixes.includes("credentials")) fixes.push("credentials");
    raw = afterTrailingSpaceCreds;
  }

  // Strip leading credentials past a comma boundary: "PhD, Sarah Chen"
  // → "Sarah Chen". Mirrors the trailing version.
  let leadingCommaStripFired = false;
  const afterLeadingCommaCreds = stripLeadingCredsBeforeComma(raw);
  if (afterLeadingCommaCreds !== raw) {
    if (!fixes.includes("credentials")) fixes.push("credentials");
    raw = afterLeadingCommaCreds;
    leadingCommaStripFired = true;
  }

  // Strip more leading credentials on a whitespace boundary ONLY if we
  // just stripped a comma-bounded credential stack. The signal: this
  // name had credentials stuffed in the front via comma, so the next
  // bare token (e.g., MCC) is probably also a credential rather than
  // initials. Without that signal we leave leading tokens alone — "JD
  // Schramm" or "MC Hammer" must not lose their first word.
  if (leadingCommaStripFired) {
    const afterLeadingSpaceCreds = stripLeadingExplicitCredsBeforeSpace(raw);
    if (afterLeadingSpaceCreds !== raw) {
      if (!fixes.includes("credentials")) fixes.push("credentials");
      raw = afterLeadingSpaceCreds;
    }
  }

  // Re-quote-strip in case credential removal exposed a stale wrap.
  const post = raw.replace(QUOTE_WRAPPER_RE, "");
  if (post !== raw) {
    if (!fixes.includes("quotes")) fixes.push("quotes");
    raw = post;
  }

  // Email-as-name rescue.
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

  // "Last, First" → "First Last". Strict bail conditions: no parens,
  // exactly one comma, both halves are short clean name candidates.
  if (shouldAttemptReversal(raw)) {
    const m = raw.match(LAST_FIRST_RE);
    if (m) {
      const last = m[1].trim();
      const first = m[2].trim();
      if (isAcceptableNamePart(first) && isAcceptableNamePart(last)) {
        fixes.push("last-first-reversal");
        raw = `${first} ${last}`;
      }
    }
  }

  // Collapse internal whitespace.
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed !== raw) {
    if (!fixes.includes("trim")) fixes.push("trim");
    raw = collapsed;
  }

  if (raw !== (input.name ?? "") && fixes.length === 0) {
    fixes.push("trim");
  }

  return { name: raw || null, fixes };
}

// ─── Credential helpers ─────────────────────────────────────────

function isKnownCredential(token: string): boolean {
  return CREDENTIAL_WORDS.has(token.toLowerCase().replace(/[.,]+$/, ""))
    || CREDENTIAL_WORDS.has(token.toLowerCase());
}

function isAcademicCredential(token: string): boolean {
  return ACADEMIC_ONLY.has(token.toLowerCase().replace(/[.,]+$/, ""))
    || ACADEMIC_ONLY.has(token.toLowerCase());
}

/** Short all-caps acronym like "MCR", "CFA", "PMP". */
function isAllCapsAcronym(token: string): boolean {
  return /^[A-Z]{2,7}\.?$/.test(token);
}

/** Dot-style credential like "Ph.D.", "M.Sc.", "Ed.D.", "M.A.". */
function isDotCredential(token: string): boolean {
  return /^([A-Z]\.){1,3}[A-Z]?\.?$/.test(token);
}

function isCredentialTokenLike(token: string): boolean {
  return isKnownCredential(token) || isAllCapsAcronym(token) || isDotCredential(token);
}

// ─── Strippers ──────────────────────────────────────────────────

function stripTrailingCredsAfterComma(s: string): string {
  const idx = s.lastIndexOf(",");
  if (idx === -1) return s;
  const head = s.slice(0, idx).trim();
  const tail = s.slice(idx + 1).trim();
  if (!tail) return s;
  const tokens = tail.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return s;
  if (tokens.every(isCredentialTokenLike)) return head;
  return s;
}

function stripTrailingAcademicAfterSpace(s: string): string {
  // Only fire when the trailing word(s) are recognized academic credentials.
  const tokens = s.split(/\s+/);
  let dropped = 0;
  while (tokens.length - dropped > 1) {
    const last = tokens[tokens.length - 1 - dropped];
    if (isAcademicCredential(last)) {
      dropped++;
      continue;
    }
    break;
  }
  if (dropped === 0) return s;
  return tokens.slice(0, tokens.length - dropped).join(" ");
}

function stripLeadingCredsBeforeComma(s: string): string {
  const idx = s.indexOf(",");
  if (idx === -1) return s;
  const head = s.slice(0, idx).trim();
  const tail = s.slice(idx + 1).trim();
  if (!head || !tail) return s;
  const tokens = head.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return s;
  if (tokens.every(isCredentialTokenLike)) return tail;
  return s;
}

function stripLeadingExplicitCredsBeforeSpace(s: string): string {
  // Strip only EXPLICIT credential words (not generic all-caps) so we
  // don't mangle "MC Hammer" or "DJ Khaled".
  const tokens = s.split(/\s+/);
  let consumed = 0;
  while (consumed < tokens.length - 1) {
    const t = tokens[consumed];
    if (isKnownCredential(t)) {
      consumed++;
      continue;
    }
    break;
  }
  if (consumed === 0) return s;
  return tokens.slice(consumed).join(" ");
}

// ─── Reversal gating ────────────────────────────────────────────

function shouldAttemptReversal(s: string): boolean {
  if (/[()]/.test(s)) return false; // "First (Company, Sub) Last" booby trap
  const commaCount = (s.match(/,/g) ?? []).length;
  if (commaCount !== 1) return false;
  return true;
}

function isAcceptableNamePart(s: string): boolean {
  if (!s) return false;
  if (s.length > 60) return false;
  if (/[@\d()]/.test(s)) return false;
  if (!/[A-Za-zÀ-ɏ]/.test(s)) return false;

  const words = s.split(/\s+/);
  if (words.length > 3) return false; // too many words for one half of a name

  for (const w of words) {
    if (isKnownCredential(w)) return false;
    if (isAllCapsAcronym(w)) return false;
    if (isDotCredential(w)) return false;
  }
  return true;
}

// ─── Email inference (unchanged) ────────────────────────────────

export function inferFromEmail(email?: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return null;
  let local = email.slice(0, at);

  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);

  const parts = local
    .split(/[._\-]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return null;

  const hasLetter = parts.some((p) => /[A-Za-z]/.test(p));
  if (!hasLetter) return null;
  if (parts.length === 1 && parts[0].length < 2) return null;
  if (parts.length === 1 && /^[0-9a-f]{12,}$/i.test(parts[0])) return null;

  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}
