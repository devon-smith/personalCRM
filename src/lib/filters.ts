// ─── Shared filtering utilities ─────────────────────────────
// Used by inbox queries, sync adapters, and auto-resolve logic.

// ─── Channel normalization ──────────────────────────────────

export function normalizeChannel(ch: string): string {
  const c = ch.toLowerCase();
  if (["imessage", "sms", "text"].includes(c)) return "text";
  if (["gmail", "email"].includes(c)) return "email";
  if (["linkedin"].includes(c)) return "linkedin";
  if (["whatsapp"].includes(c)) return "whatsapp";
  return c;
}

// ─── Tapback detection ──────────────────────────────────────

export const TAPBACK_VERBS = [
  "Loved", "Liked", "Laughed at", "Emphasized",
  "Disliked", "Questioned",
] as const;

export function isTapback(summary: string): boolean {
  if (!summary) return false;
  const s = summary.replace(/^\(in group chat\)\s*/i, "").trim();
  for (const verb of TAPBACK_VERBS) {
    if (s.startsWith(`${verb} \u201C`) || s.startsWith(`${verb} "`)) return true;
    if (new RegExp(`^${verb}\\s+(a |an )`, "i").test(s)) return true;
  }
  if (/^Reacted\s+.+\s+to\s+/i.test(s)) return true;
  return false;
}

// Pre-built SQL patterns for tapback exclusion in raw queries
export const TAPBACK_SQL_PATTERNS = [
  ...TAPBACK_VERBS.flatMap((v) => [
    `${v} \u201C`,
    `${v} "`,
    `${v} a `,
    `${v} an `,
  ]),
  "(in group chat) Loved",
  "(in group chat) Liked",
  "(in group chat) Laughed at",
  "(in group chat) Emphasized",
  "(in group chat) Disliked",
  "(in group chat) Questioned",
  "Reacted ",
];

export const TAPBACK_SQL = TAPBACK_SQL_PATTERNS
  .map((p) => `"summary" NOT LIKE '${p.replace(/'/g, "''")}%'`)
  .join(" AND ");

// ─── Summary sanitization ───────────────────────────────────
// The attributedBody parser can concatenate multiple notification-stack
// messages into one summary separated by newlines. Truncate at first newline.

export function sanitizeSummary(summary: string | null): string | null {
  if (!summary) return summary;
  const newlineIdx = summary.indexOf("\n");
  if (newlineIdx === -1) return summary;
  return summary.slice(0, newlineIdx).trim() || summary;
}

// ─── Conversation-ender detection ───────────────────────────

const CONVERSATION_ENDERS = new Set([
  "ok", "okay", "k", "kk",
  "thanks", "thank you", "thx", "ty", "tysm",
  "cool", "nice", "great", "awesome", "perfect", "sweet", "dope", "sick", "fire",
  "totally", "absolutely", "definitely", "exactly", "yep", "yup", "yeah", "ya", "yea", "yes",
  "nope", "nah", "no", "naw",
  "lol", "lmao", "haha", "hahaha", "ha",
  "bet", "word", "facts", "true", "same", "mood", "real", "fr", "no cap",
  "sounds good", "sounds great", "all good", "no worries", "np", "no problem",
  "got it", "gotcha", "understood", "copy", "roger",
  "good night", "goodnight", "gn", "night",
  "bye", "later", "peace", "cya", "see ya", "ttyl",
  "love you", "love u",
  "will do", "on it", "done", "sent",
  "omg", "wow", "whoa", "damn", "dang", "sheesh",
  "idk", "idc", "nvm", "nevermind",
  "congrats", "congratulations",
]);

const ENDER_PREFIXES = [
  "thanks", "thank you", "thx", "ty",
  "sounds good", "sounds great",
  "all good", "no worries", "no problem",
  "got it", "gotcha",
  "will do", "on it",
  "love you", "love u",
  "congrats", "congratulations",
  "nah", "nope",
  "good night", "goodnight",
  "bye", "later", "peace", "see ya",
];

const ENDER_PATTERNS = [
  /^(ha){2,}/i,
  /^l+m+a+o+/i,
  /^huge\b/i,
  /^nice\b/i,
  /^sick\b/i,
  /^dope\b/i,
  /^fire\b/i,
  /^damn\b/i,
  /^wow\b/i,
  /^omg\b/i,
  /^sheesh\b/i,
  /^yea(h)?\b/i,
  /^for sure\b/i,
  /^of course\b/i,
  /^(o?k(ay)?)\b/i,
];

export function isConversationEnder(summary: string | null): boolean {
  if (!summary) return false;
  const cleaned = summary
    .replace(/^\(in group chat\)\s*/i, "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+$/g, "");
  if (!cleaned) return false;

  // Emoji-only messages
  if (/^[\p{Emoji}\s]{1,12}$/u.test(cleaned) && /\p{Emoji}/u.test(cleaned)) return true;

  const wordCount = cleaned.split(/\s+/).length;
  if (wordCount > 8) return false;

  if (CONVERSATION_ENDERS.has(cleaned)) return true;

  if (wordCount <= 6) {
    for (const prefix of ENDER_PREFIXES) {
      if (cleaned === prefix || cleaned.startsWith(prefix + " ")) return true;
    }
  }

  if (wordCount <= 4) {
    for (const pattern of ENDER_PATTERNS) {
      if (pattern.test(cleaned)) return true;
    }
  }

  return false;
}
