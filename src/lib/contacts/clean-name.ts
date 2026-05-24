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

// Subset safe to strip on a whitespace-only boundary (no comma needed).
// CRITICAL: these must be unambiguous credentials with no realistic chance
// of being a real name. Two-letter degree abbreviations (MA, MS, BA, BS)
// are NOT here — they collide with common surnames (Ma, Wu, Su, Lu) and
// would mangle "Jeff Ma" into "Jeff". With a comma boundary those forms
// still strip via CREDENTIAL_WORDS; without one, leave them alone.
const ACADEMIC_ONLY = new Set<string>([
  "phd", "ph.d", "ph.d.",
  "mba", "m.b.a", "m.b.a.",
  "msc", "m.sc", "m.sc.",
  "mph", "m.p.h", "m.p.h.",
  "mfa", "m.f.a", "m.f.a.",
  "jd", "j.d", "j.d.",
  "llm", "ll.m", "ll.m.",
  "edd", "ed.d", "ed.d.",
  "dds", "d.d.s", "d.d.s.",
  "dvm", "d.v.m", "d.v.m.",
  "bsc", "b.sc", "b.sc.",
  "cfa", "c.f.a", "c.f.a.",
  "cpa", "c.p.a", "c.p.a.",
  "esq", "esq.",
  // MD intentionally retained — "MD" as a degree is far more common than
  // "MD" as a name token. MA/MS/BA/BS/RN are not — common surname collisions.
  "md", "m.d", "m.d.",
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

  // Strip trailing credentials past a comma boundary. Loops because
  // "David Yu, PhD, CFA" needs two passes — first strips CFA, second
  // strips PhD.
  let credLoopPrev = "";
  while (credLoopPrev !== raw) {
    credLoopPrev = raw;
    const afterTrailingCommaCreds = stripTrailingCredsAfterComma(raw);
    if (afterTrailingCommaCreds !== raw) {
      if (!fixes.includes("credentials")) fixes.push("credentials");
      raw = afterTrailingCommaCreds;
    }
  }

  // Strip trailing academic credentials on a whitespace boundary too —
  // restricted to the ACADEMIC_ONLY set so we don't eat names ending in
  // "IV", "Jr.", "Ma", or random acronyms.
  const afterTrailingSpaceCreds = stripTrailingAcademicAfterSpace(raw);
  if (afterTrailingSpaceCreds !== raw) {
    if (!fixes.includes("credentials")) fixes.push("credentials");
    raw = afterTrailingSpaceCreds;
  }

  // Strip leading credentials past a comma boundary: "PhD, Sarah Chen"
  // → "Sarah Chen". Same loop pattern as the trailing version.
  let leadingCommaStripFired = false;
  let leadingLoopPrev = "";
  while (leadingLoopPrev !== raw) {
    leadingLoopPrev = raw;
    const afterLeadingCommaCreds = stripLeadingCredsBeforeComma(raw);
    if (afterLeadingCommaCreds !== raw) {
      if (!fixes.includes("credentials")) fixes.push("credentials");
      raw = afterLeadingCommaCreds;
      leadingCommaStripFired = true;
    }
  }

  // Strip more leading credentials on a whitespace boundary ONLY if we
  // just stripped a comma-bounded credential stack. The signal: this
  // name had credentials stuffed in the front via comma, so the next
  // bare token (e.g., MCC, MBE) is probably also a credential rather
  // than initials. Without that signal we leave leading tokens alone —
  // "JD Schramm" or "MC Hammer" must not lose their first word.
  //
  // When the signal is present we also accept short all-caps acronyms,
  // catching things like MBE / OBE / CISSP without needing every cert
  // code in the dictionary.
  if (leadingCommaStripFired) {
    const afterLeadingSpaceCreds = stripLeadingCredsBeforeSpace(raw, true);
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

  // Sweep up trailing punctuation that the credential strip left behind.
  // "Cena Kamali - MSc, MA" → "Cena Kamali -" after creds → "Cena Kamali"
  // "Daniel Castro. MD, MBA"  → "Daniel Castro." after creds → "Daniel Castro"
  // "Pejman H."               → unchanged (single-letter initial preserved)
  const swept = sweepTrailingPunctuation(raw);
  if (swept !== raw) {
    if (!fixes.includes("trim")) fixes.push("trim");
    raw = swept;
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

/**
 * Default credential check used by comma-bounded strippers. Conservative:
 * only known dictionary words and dot-credentials (Ph.D., M.Sc.). Does
 * NOT include arbitrary short all-caps acronyms — that would treat
 * "MULCAHY,SIMON" → strip SIMON, mangling the name. The aggressive
 * variant in stripLeadingCredsBeforeSpace adds the all-caps fallback
 * only when stateful context guarantees we're in credential-stuff land.
 */
function isCredentialTokenLike(token: string): boolean {
  return isKnownCredential(token) || isDotCredential(token);
}

function isCredentialTokenLikeAggressive(token: string): boolean {
  return isCredentialTokenLike(token) || isAllCapsAcronym(token);
}

// ─── Strippers ──────────────────────────────────────────────────

function stripTrailingCredsAfterComma(s: string): string {
  const idx = s.lastIndexOf(",");
  if (idx === -1) return s;
  const head = s.slice(0, idx).trim();
  const tail = s.slice(idx + 1).trim();
  if (!tail) return s;

  // Guard: if the head is itself entirely credentials, the input is
  // probably "CRED1, CRED2, ... NAME" and stripping the tail would leave
  // us with a credential as the name. Bail. This prevents the catastrophic
  // case where "PhD, LLB, MBA, MCOM, FELLOW DR DD SWAIN" was stripped down
  // to just "PhD" — every left-side token was a credential AND the tail
  // (FELLOW DR DD SWAIN) looked like credentials thanks to the all-caps
  // pattern, so the loop devoured the whole name.
  if (isAllCredentialString(head)) return s;

  const tokens = tail.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return s;

  // Conservative: dictionary credentials and dot-credentials always strip.
  if (tokens.every(isCredentialTokenLike)) return head;

  // Aggressive fallback: also strip short all-caps tokens (CISSP, CCNA),
  // but only when the head is title-case. The head shape distinguishes
  // "Sarah Chen, CISSP" (Name, Credential — strip) from "MULCAHY,SIMON"
  // (CSV-export LAST,FIRST — don't strip, SIMON is a name).
  if (isMixedCaseHead(head) && tokens.every(isCredentialTokenLikeAggressive)) {
    return head;
  }
  return s;
}

function isMixedCaseHead(head: string): boolean {
  // Has at least one lowercase letter → not an all-caps CSV-style export.
  return /[a-z]/.test(head);
}

/**
 * True when the input is comma/space-separated tokens that all look like
 * credentials. Used as an over-strip guard.
 */
function isAllCredentialString(s: string): boolean {
  const tokens = s.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every(isCredentialTokenLikeAggressive);
}

/**
 * Strip trailing punctuation left behind after credential removal —
 * dangling separators that used to live between the name and the
 * credentials.
 *
 * Cases handled:
 *  - "Cena Kamali - "      → "Cena Kamali"    (dash separator)
 *  - "Daniel Castro."      → "Daniel Castro"  (period separator)
 *  - "Marc H."             → "Marc H."        (single-letter initial preserved)
 *  - "name,"               → "name"           (trailing comma)
 *  - "name -, "            → "name"           (combination)
 *
 * The period rule is the subtle one: drop a trailing period only when
 * the last word-token has 2+ letters before it. "Pejman H." has a
 * single-letter token + period (initial), so the period stays.
 */
function sweepTrailingPunctuation(s: string): string {
  let out = s;

  // Iteratively strip trailing dashes, commas, and qualifying periods.
  // Loop because "name -, " needs both the comma and the dash removed.
  let prev = "";
  while (prev !== out) {
    prev = out;

    // Trailing comma (with optional surrounding whitespace).
    out = out.replace(/\s*,\s*$/, "").trimEnd();

    // Trailing dash separator (must be preceded by whitespace to avoid
    // touching hyphenated names like "Sharabi-Levine" or "O'Connor-Smith").
    out = out.replace(/\s+[-–—]\s*$/, "").trimEnd();

    // Trailing period — drop only when the last token is long enough to
    // be a real word. 4+ letters before the period.
    //   "Pejman H."        → keep (1-letter initial)
    //   "Bob Smith Jr."    → keep (2-letter generational abbreviation)
    //   "Cleo III."        → keep (3-letter generational)
    //   "Daniel Castro."   → drop (6-letter full word, period is a stray
    //                              separator left from "Castro. MD")
    if (out.endsWith(".")) {
      const m = out.match(/(\S+)$/);
      if (m) {
        const lastTok = m[1];
        if (/^[A-Za-zÀ-ɏ]{4,}\.$/.test(lastTok)) {
          out = out.slice(0, -1).trimEnd();
        }
      }
    }
  }

  return out;
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

function stripLeadingCredsBeforeSpace(s: string, aggressive: boolean): string {
  // Only called from the stateful path — after stripLeadingCredsBeforeComma
  // has already fired. When aggressive=true we also strip short all-caps
  // tokens (MBE, OBE, CISSP) that aren't in the dictionary but are
  // almost certainly credentials given the established context.
  const tokens = s.split(/\s+/);
  let consumed = 0;
  const matches = aggressive
    ? isCredentialTokenLikeAggressive
    : isKnownCredential;
  while (consumed < tokens.length - 1) {
    const t = tokens[consumed];
    if (matches(t)) {
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
