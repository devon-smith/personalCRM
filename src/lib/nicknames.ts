/**
 * Nickname / Alias Matching Engine
 *
 * Maps common given names to their variants (nicknames, diminutives,
 * short forms). Used by the identity resolution engine to detect
 * that "Will Smith" and "William Smith" are likely the same person.
 *
 * Structure: Each group is a set of names that are all considered
 * variants of each other. If any name in a group matches,
 * all other names in that group are considered potential matches.
 */

// ─── Nickname groups ─────────────────────────────────────────
// Each inner array is a group of names that are variants of each other.
// Order doesn't matter — the engine builds a bidirectional lookup.

const NICKNAME_GROUPS: readonly (readonly string[])[] = [
  // A
  ["aaron", "ari"],
  ["abigail", "abby", "abbie", "gail"],
  ["abraham", "abe"],
  ["adaline", "addie", "ada"],
  ["alexander", "alex", "xander", "sasha", "lex"],
  ["alexandra", "alex", "lexi", "sasha", "sandy"],
  ["alfred", "al", "fred", "alfie"],
  ["alice", "ali"],
  ["allison", "allie", "ali"],
  ["amanda", "mandy", "mandi"],
  ["anastasia", "ana", "stacy"],
  ["andrew", "andy", "drew"],
  ["angela", "angie"],
  ["ann", "anna", "annie", "nan", "nancy"],
  ["anthony", "tony", "ant"],
  ["antonia", "toni"],
  ["arthur", "art", "artie"],

  // B
  ["barbara", "barb", "barbie", "babs"],
  ["bartholomew", "bart"],
  ["beatrice", "bea", "trixie"],
  ["benjamin", "ben", "benny", "benji"],
  ["bernadette", "bernie"],
  ["bradley", "brad"],
  ["brandon", "bran"],
  ["bridget", "birdie"],

  // C
  ["cameron", "cam"],
  ["caroline", "carrie", "carol", "caro"],
  ["catherine", "kate", "katie", "cathy", "cat", "kathy", "kitty", "kay"],
  ["charles", "charlie", "chuck", "chas", "chaz"],
  ["charlotte", "charlie", "lottie", "char"],
  ["christina", "chris", "tina", "christy", "chrissy"],
  ["christopher", "chris", "topher", "kit"],
  ["clarence", "clare"],
  ["clifford", "cliff"],
  ["constance", "connie"],
  ["cornelius", "neil"],
  ["cynthia", "cindy"],

  // D
  ["daniel", "dan", "danny"],
  ["danielle", "dani", "elle"],
  ["david", "dave", "davey"],
  ["deborah", "debbie", "deb"],
  ["dennis", "denny"],
  ["diana", "di"],
  ["donald", "don", "donnie"],
  ["dorothy", "dot", "dotty", "dottie"],
  ["douglas", "doug"],

  // E
  ["edward", "ed", "eddie", "ted", "teddy", "ned"],
  ["eleanor", "ellie", "elle", "nell", "nelly", "nora"],
  ["elizabeth", "liz", "lizzy", "beth", "betty", "eliza", "libby", "betsy"],
  ["emily", "em", "emmy"],
  ["emma", "em", "emmy"],
  ["ernest", "ernie"],
  ["eugene", "gene"],
  ["evelyn", "evie", "ev"],
  ["ezekiel", "zeke"],

  // F
  ["florence", "flo"],
  ["frances", "fran", "frankie", "frannie"],
  ["francis", "frank", "frankie"],
  ["frederick", "fred", "freddy", "fritz"],

  // G
  ["gabriel", "gabe"],
  ["gabrielle", "gabby", "elle"],
  ["geoffrey", "geoff", "jeff"],
  ["george", "georgie"],
  ["gerald", "gerry", "jerry"],
  ["geraldine", "geri"],
  ["gertrude", "trudy"],
  ["gregory", "greg"],
  ["gwendolyn", "gwen"],

  // H
  ["harold", "harry", "hal"],
  ["harriet", "hattie"],
  ["harrison", "harry"],
  ["heather", "heath"],
  ["henry", "hank", "harry", "hal"],
  ["howard", "howie"],
  ["humphrey", "humph"],

  // I-J
  ["ignatius", "iggy"],
  ["isaiah", "ike", "zay"],
  ["isidore", "izzy"],
  ["jacqueline", "jackie", "jack"],
  ["james", "jim", "jimmy", "jamie", "jem"],
  ["janet", "jan"],
  ["jasmine", "jas", "jazzy"],
  ["jason", "jay", "jace"],
  ["jean", "jeanie"],
  ["jennifer", "jen", "jenny", "jenn"],
  ["jeremiah", "jeremy", "jerry"],
  ["jessica", "jess", "jessie"],
  ["joan", "joanie"],
  ["joanna", "jo", "jojo"],
  ["jonathan", "jon", "jonny", "nate"],
  ["joseph", "joe", "joey", "jo"],
  ["josephine", "josie", "jo", "fifi"],
  ["joshua", "josh"],
  ["judith", "judy", "jude"],

  // K
  ["kathleen", "kathy", "kate", "katie", "kat"],
  ["kenneth", "ken", "kenny"],
  ["kimberly", "kim", "kimmy"],
  ["kristopher", "kris"],

  // L
  ["laurence", "larry", "lars"],
  ["leonard", "leo", "lenny"],
  ["lillian", "lily", "lil", "lilly"],
  ["lincoln", "linc"],
  ["linda", "lindy"],
  ["louis", "lou", "louie"],
  ["louise", "lou"],
  ["lucas", "luke"],
  ["lucille", "lucy", "lu"],
  ["lydia", "liddy"],

  // M
  ["mackenzie", "mack", "kenzie"],
  ["madeline", "maddie", "maddy"],
  ["madison", "maddie", "madi"],
  ["margaret", "maggie", "meg", "peggy", "marge", "margie", "greta", "margo"],
  ["maria", "mary"],
  ["martha", "marty"],
  ["martin", "marty"],
  ["mathew", "matt", "matty"],
  ["matthew", "matt", "matty"],
  ["maureen", "mo"],
  ["maximilian", "max"],
  ["maxwell", "max"],
  ["melanie", "mel"],
  ["melissa", "mel", "missy", "lissa"],
  ["michael", "mike", "mikey", "mick"],
  ["michelle", "shelly", "mich"],
  ["mildred", "millie"],
  ["mitchell", "mitch"],
  ["montgomery", "monty"],
  ["morgan", "mo"],

  // N
  ["nadine", "nadi"],
  ["natalie", "nat", "natty"],
  ["natasha", "tasha", "nat"],
  ["nathan", "nate"],
  ["nathaniel", "nate", "nat"],
  ["nicholas", "nick", "nicky", "nico"],
  ["nicole", "nicky", "nikki", "cole"],
  ["nigel", "nige"],

  // O
  ["oliver", "ollie", "olly"],
  ["olivia", "liv", "livvy"],

  // P
  ["pamela", "pam"],
  ["patricia", "pat", "patty", "trish", "tricia"],
  ["patrick", "pat", "paddy", "rick"],
  ["penelope", "penny"],
  ["peter", "pete"],
  ["philip", "phil"],
  ["priscilla", "prissy", "cilla"],

  // R
  ["rachel", "rach"],
  ["randolph", "randy"],
  ["raymond", "ray"],
  ["rebecca", "becky", "becca", "bec"],
  ["regina", "gina"],
  ["reginald", "reggie", "reg"],
  ["richard", "rick", "rich", "dick", "ricky"],
  ["robert", "rob", "robbie", "bob", "bobby", "bert"],
  ["roberta", "robbie", "bobbie"],
  ["roderick", "rod"],
  ["ronald", "ron", "ronnie"],
  ["rosalind", "ros", "roz"],
  ["russell", "russ", "rusty"],

  // S
  ["samantha", "sam", "sammy"],
  ["samuel", "sam", "sammy"],
  ["sandra", "sandy"],
  ["sebastian", "seb", "bash"],
  ["sharon", "shari"],
  ["solomon", "sol"],
  ["sophia", "sophie", "soph"],
  ["stanley", "stan"],
  ["stephanie", "steph", "stevie"],
  ["stephen", "steve", "stevie"],
  ["steven", "steve", "stevie"],
  ["stuart", "stu"],
  ["susan", "sue", "suzy", "susie"],
  ["suzanne", "sue", "suzy"],
  ["sylvia", "syl"],

  // T
  ["tabitha", "tabby"],
  ["teresa", "terry", "tess", "tessa"],
  ["theodore", "ted", "teddy", "theo"],
  ["thomas", "tom", "tommy"],
  ["timothy", "tim", "timmy"],
  ["tobias", "toby"],

  // V
  ["valentina", "val"],
  ["valerie", "val"],
  ["vanessa", "nessa"],
  ["veronica", "ronnie", "roni"],
  ["victoria", "vicky", "tori", "vic"],
  ["vincent", "vince", "vin", "vinny"],
  ["virginia", "ginny", "ginger"],
  ["vivian", "viv"],

  // W
  ["wallace", "wally"],
  ["walter", "walt", "wally"],
  ["wesley", "wes"],
  ["william", "will", "willy", "bill", "billy", "liam"],
  ["wilma", "wil"],
  ["winston", "win"],

  // Z
  ["zachary", "zach", "zack", "zak"],
];

// ─── Lookup index ────────────────────────────────────────────

/** Maps a lowercase name to all its known aliases (including itself). */
const NICKNAME_INDEX = new Map<string, ReadonlySet<string>>();

function buildIndex(): void {
  for (const group of NICKNAME_GROUPS) {
    const fullSet = new Set(group);
    for (const name of group) {
      const existing = NICKNAME_INDEX.get(name);
      if (existing) {
        // Merge sets if a name appears in multiple groups
        const merged = new Set([...existing, ...fullSet]);
        for (const n of merged) {
          NICKNAME_INDEX.set(n, merged);
        }
      } else {
        NICKNAME_INDEX.set(name, fullSet);
      }
    }
  }
}

buildIndex();

// ─── Public API ──────────────────────────────────────────────

/**
 * Get all known nickname variants for a given first name.
 * Returns a set including the input name itself.
 * Returns a single-element set if no nicknames are known.
 */
export function getNicknameVariants(firstName: string): ReadonlySet<string> {
  const key = firstName.toLowerCase().trim();
  return NICKNAME_INDEX.get(key) ?? new Set([key]);
}

/**
 * Check if two first names are nickname-equivalent.
 * e.g. namesAreRelated("William", "Bill") → true
 */
export function namesAreRelated(nameA: string, nameB: string): boolean {
  const a = nameA.toLowerCase().trim();
  const b = nameB.toLowerCase().trim();
  if (a === b) return true;

  const variantsA = NICKNAME_INDEX.get(a);
  return variantsA?.has(b) ?? false;
}

/**
 * Check if two first names could match via nickname AND share the same last name.
 * This is the primary matching signal for nickname-based identity resolution.
 */
export function isNicknameMatch(
  fullNameA: string,
  fullNameB: string,
): boolean {
  const partsA = fullNameA.trim().split(/\s+/);
  const partsB = fullNameB.trim().split(/\s+/);

  if (partsA.length < 2 || partsB.length < 2) return false;

  const firstA = partsA[0].toLowerCase();
  const firstB = partsB[0].toLowerCase();
  const lastA = partsA.slice(1).join(" ").toLowerCase();
  const lastB = partsB.slice(1).join(" ").toLowerCase();

  // Last names must match
  if (lastA !== lastB) return false;

  // First names must be exact or nickname-related
  if (firstA === firstB) return false; // exact match is handled elsewhere
  return namesAreRelated(firstA, firstB);
}

// ─── Scanning for unlinked nickname matches ──────────────────

export interface NicknameMatchSuggestion {
  readonly contactA: { id: string; name: string; company: string | null; email: string | null };
  readonly contactB: { id: string; name: string; company: string | null; email: string | null };
  readonly matchedFirstNames: [string, string];
  readonly sharedLastName: string;
  readonly confidence: number;
}

/**
 * Scan a list of contacts and find pairs that might be the same
 * person based on nickname matching.
 *
 * Returns pairs sorted by confidence (highest first).
 * Excludes contacts that already share the same primary email.
 */
export function findNicknameMatches(
  contacts: readonly {
    id: string;
    name: string;
    company: string | null;
    email: string | null;
    nicknames: string[];
  }[],
): NicknameMatchSuggestion[] {
  const suggestions: NicknameMatchSuggestion[] = [];
  const seenPairs = new Set<string>();

  // Index by normalized last name for efficient matching
  const byLastName = new Map<string, typeof contacts[number][]>();

  for (const contact of contacts) {
    const parts = contact.name.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const lastName = parts.slice(1).join(" ").toLowerCase();
    const list = byLastName.get(lastName) ?? [];
    list.push(contact);
    byLastName.set(lastName, list);
  }

  for (const [lastName, group] of byLastName) {
    if (group.length < 2) continue;

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];

        // Skip if same email (already linked)
        if (
          a.email &&
          b.email &&
          a.email.toLowerCase() === b.email.toLowerCase()
        ) {
          continue;
        }

        // Skip if previously dismissed
        const aDismissedB = a.nicknames.some(
          (n) => n === `!not:${b.name.split(/\s+/)[0].toLowerCase()}:${b.id}`,
        );
        const bDismissedA = b.nicknames.some(
          (n) => n === `!not:${a.name.split(/\s+/)[0].toLowerCase()}:${a.id}`,
        );
        if (aDismissedB || bDismissedA) continue;

        // Skip if one is already listed as a nickname of the other
        const aFirst = a.name.split(/\s+/)[0].toLowerCase();
        const bFirst = b.name.split(/\s+/)[0].toLowerCase();

        if (aFirst === bFirst) continue;

        // Check explicit nicknames field first (exclude dismissal markers)
        const aHasB =
          a.nicknames.some((n) => !n.startsWith("!not:") && n.toLowerCase() === bFirst) ||
          b.nicknames.some((n) => !n.startsWith("!not:") && n.toLowerCase() === aFirst);

        // Check the nickname dictionary
        const dictMatch = namesAreRelated(aFirst, bFirst);

        if (!aHasB && !dictMatch) continue;

        // Deduplicate pairs
        const pairKey = [a.id, b.id].sort().join(":");
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        // Score confidence
        let confidence = 0.65;
        if (aHasB) confidence = 0.85; // explicit nickname → higher confidence
        if (
          a.company &&
          b.company &&
          a.company.toLowerCase() === b.company.toLowerCase()
        ) {
          confidence += 0.10; // same company → boost
        }

        suggestions.push({
          contactA: {
            id: a.id,
            name: a.name,
            company: a.company,
            email: a.email,
          },
          contactB: {
            id: b.id,
            name: b.name,
            company: b.company,
            email: b.email,
          },
          matchedFirstNames: [aFirst, bFirst],
          sharedLastName: lastName,
          confidence: Math.min(confidence, 0.95),
        });
      }
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}
