/**
 * News-mention disambiguation gate (M0.x.10).
 *
 * The signal-detection worker queries Brave Search for `"Contact Name"
 * Company`, but for common names (Toby Smith, Connor, etc.) Brave still
 * returns unrelated articles about a different person with the same
 * name. The gate filters those out by requiring the article's title
 * or description to mention at least one distinctive affiliation
 * token tied to OUR contact — their company, role, scholarly
 * institution, expertise area, or a manual tag.
 *
 * Quick-and-cheap: substring match, no LLM call, no embeddings. Trades
 * a small amount of recall (we'll miss articles that don't echo the
 * contact's affiliations in the snippet) for a large drop in false
 * positives (random "Toby Smith - podcast wiki" results no longer
 * surface).
 *
 * Pure functions. The worker owns the data fetch; this module owns
 * the decision logic + tokenization rules.
 */

export interface ContactAffiliations {
  /** Contact.company — typically the strongest distinctive token. */
  readonly company: string | null;
  /** Contact.role — usually too generic on its own ("CEO", "Engineer")
   *  but distinctive titles can match ("Chief Health Officer"). */
  readonly role: string | null;
  /** Contact.lastSeenScholarlyInstitution — OpenAlex affiliation. */
  readonly scholarlyInstitution: string | null;
  /** Contact.tags — free-form manual labels Jennifer applies. */
  readonly tags: ReadonlyArray<string>;
  /** ContactProfile.expertiseAreas — Claude-extracted topic labels. */
  readonly expertiseAreas: ReadonlyArray<string>;
}

export interface ArticleSnippet {
  readonly title: string;
  readonly description: string | null;
}

export interface GateResult {
  readonly passes: boolean;
  /** The token that matched (lower-cased), or null when nothing matched. */
  readonly matchedToken: string | null;
  /** Distinct tokens the gate considered — surfaced in logs for tuning. */
  readonly tokensConsidered: ReadonlyArray<string>;
}

/**
 * Words that are too generic to count as a disambiguating affiliation
 * even when they appear in a contact's company/role/title. A contact
 * with role="CEO" working at "OpenEvidence" should match articles
 * mentioning "OpenEvidence" but NOT articles mentioning some random
 * other CEO.
 */
const STOP_WORDS = new Set([
  // Company suffixes
  "inc", "llc", "ltd", "co", "corp", "corporation", "company",
  "group", "team", "studio", "labs", "ventures", "partners",
  "international", "global", "holdings",
  // Filler
  "the", "and", "of", "in", "for", "at", "an", "to",
  // Generic role/title words
  "ceo", "cfo", "coo", "cto", "vp", "evp", "svp",
  "director", "manager", "lead", "head", "chief",
  "founder", "cofounder", "co-founder",
  "professor", "associate", "assistant", "adjunct",
  "phd", "md", "dr", "mr", "ms", "mrs",
  "research", "engineer", "engineering", "scientist",
  "analyst", "consultant", "specialist",
  "senior", "junior", "principal",
  // Education filler
  "university", "college", "school", "institute", "academy",
  "department", "faculty", "alumni",
]);

/**
 * Minimum chars for a token to count as "distinctive". 3 keeps
 * acronyms like GSB, MIT, NIH, IMF in play while still excluding
 * filler ("of", "in", "the" — all in STOP_WORDS for safety).
 */
const MIN_TOKEN_LENGTH = 3;

/**
 * Decide whether an article is plausibly about THIS contact. Returns
 * `passes: false` when no affiliation token from the contact appears
 * in the article snippet — those are likely name-collision noise.
 *
 * Special case: if the contact has no usable affiliation tokens at
 * all (empty company / role / institution / tags / expertise), we
 * return passes=false rather than allowing through. The false-positive
 * risk is highest exactly when we have nothing to verify against.
 */
export function articleMentionsAffiliation(
  affiliations: ContactAffiliations,
  article: ArticleSnippet,
): GateResult {
  const tokens = buildAffiliationTokens(affiliations);
  if (tokens.length === 0) {
    return { passes: false, matchedToken: null, tokensConsidered: [] };
  }

  const haystack = `${article.title} ${article.description ?? ""}`.toLowerCase();
  for (const token of tokens) {
    if (haystack.includes(token)) {
      return {
        passes: true,
        matchedToken: token,
        tokensConsidered: tokens,
      };
    }
  }
  return { passes: false, matchedToken: null, tokensConsidered: tokens };
}

/**
 * Pull distinctive tokens out of a contact's affiliations. Returns
 * lower-cased, deduped strings. Exported for test visibility.
 */
export function buildAffiliationTokens(
  a: ContactAffiliations,
): string[] {
  const phrases: string[] = [];
  if (a.company) phrases.push(a.company);
  if (a.role) phrases.push(a.role);
  if (a.scholarlyInstitution) phrases.push(a.scholarlyInstitution);
  phrases.push(...a.tags);
  phrases.push(...a.expertiseAreas);

  const tokens = new Set<string>();
  for (const phrase of phrases) {
    const trimmed = phrase.trim();
    if (!trimmed) continue;

    // Whole-phrase token when distinctive.
    const lower = trimmed.toLowerCase();
    if (
      trimmed.length >= MIN_TOKEN_LENGTH &&
      !STOP_WORDS.has(lower) &&
      // Reject pure-numeric phrases like a department code.
      !/^[\d\s.-]+$/.test(trimmed)
    ) {
      tokens.add(lower);
    }

    // Sub-word tokens — when a phrase has multiple words, every
    // distinctive word becomes its own match needle. "Stanford GSB"
    // → both "stanford" and "gsb" pass.
    const words = trimmed.split(/[\s/&,.-]+/);
    if (words.length > 1) {
      for (const w of words) {
        const cleaned = w.replace(/[^a-zA-Z0-9]/g, "");
        if (cleaned.length < MIN_TOKEN_LENGTH) continue;
        const cl = cleaned.toLowerCase();
        if (STOP_WORDS.has(cl)) continue;
        tokens.add(cl);
      }
    }
  }
  return Array.from(tokens);
}
