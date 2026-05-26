/**
 * Noise contact detection (M0.4).
 *
 * Heuristic classifier for contacts that are clearly system artifacts
 * rather than real people — "Settings", "noreply@…", "LinkedIn", etc.
 *
 * Used to soft-quarantine via `Contact.isNoise`: a one-shot script
 * runs this over the corpus, search / neighbors / People page filter
 * `isNoise=false` by default, but a "show system contacts" toggle can
 * still reveal them (Jennifer can recover false positives).
 *
 * Bias is intentionally toward false negatives. If a contact looks
 * ambiguous (a real first name with an automation-flavored email),
 * we leave them visible. A real person named "Settings" or "Help"
 * would not be flagged unless their email or domain also screams
 * system.
 */

const SYSTEM_EMAIL_LOCALS = new Set([
  "noreply",
  "no-reply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "do_not_reply",
  "notification",
  "notifications",
  "alert",
  "alerts",
  "info",
  "support",
  "help",
  "team",
  "member",
  "members",
  "invitations",
  "invitation",
  "invite",
  "hello",
  "hi",
  "contact",
  "admin",
  "postmaster",
  "mailer-daemon",
  "newsletter",
  "news",
  "marketing",
  "updates",
  "billing",
  "receipts",
  "receipt",
  "invoice",
  "invoices",
  "account",
  "accounts",
  "security",
]);

// Names that are obviously system artifacts on their own. Single word,
// generic, capitalized like a label. We require the name to be the
// EXACT phrase (case-insensitive) — "Settings" matches but
// "Settings Bureau" or "John Settings" does not.
const SYSTEM_NAME_PHRASES = new Set([
  "settings",
  "help",
  "helpful",
  "updates",
  "notifications",
  "notification",
  "alerts",
  "alert",
  "apple id",
  "apple",
  "google",
  "microsoft",
  "linkedin",
  "twitter",
  "x corp",
  "facebook",
  "meta",
  "instagram",
  "youtube",
  "stripe",
  "intercom",
  "zendesk",
  "calendly",
  "zoom",
  "slack",
  "github",
  "stack overflow",
  "stanford it help",
  "noreply",
  "no reply",
  "mailer daemon",
  "postmaster",
  "team",
  "info",
  "support",
  "the team",
  "the support team",
]);

// Domains that send exclusively automated traffic. A match here alone
// is enough — even a name like "Jennifer Aaker" coming from
// notify.linkedin.com is the LinkedIn bot, not Jennifer.
//
// Note: we DON'T include linkedin.com here — real LinkedIn employees
// email from @linkedin.com. Only the notify./e. subdomains are bots.
// Same logic for stripe.com (employees) vs email.stripe.com (bots).
// And googlemail.com is just the UK-facing alias of gmail.com —
// real people, not a system.
const AUTOMATION_DOMAINS = new Set([
  "notify.linkedin.com",
  "e.linkedin.com",
  "mail.notion.so",
  "calendar-notification.google.com",
  "mail.google.com",
  "no-reply.accounts.google.com",
  "noreply.github.com",
  "mailer.notion.so",
  "email.stripe.com",
  "bounce.stripe.com",
  "mail.intercom.io",
  "intercom-mail.com",
  "mail.zendesk.com",
  "email.calendly.com",
  "mail.calendly.com",
  "email.zoom.us",
  "no-reply.zoom.us",
  "no-reply.slack.com",
]);

export interface NoiseInput {
  name: string | null | undefined;
  email: string | null | undefined;
}

export interface NoiseResult {
  isNoise: boolean;
  /** Empty when isNoise=false. Otherwise lists the rules that matched. */
  reasons: string[];
}

/**
 * Classify a contact as noise (system artifact) or real person.
 *
 * Returns a structured result so callers can persist the reasons for
 * audit / debugging. For a boolean-only check, just read `.isNoise`.
 */
export function classifyNoiseContact(input: NoiseInput): NoiseResult {
  const reasons: string[] = [];

  const rawName = (input.name ?? "").trim();
  const rawEmail = (input.email ?? "").trim();

  const normalizedName = rawName.toLowerCase();
  const localAndDomain = parseEmail(rawEmail);

  if (normalizedName && SYSTEM_NAME_PHRASES.has(normalizedName)) {
    reasons.push(`name:phrase=${normalizedName}`);
  }

  if (localAndDomain) {
    const { local, domain } = localAndDomain;

    const localBase = stripPlusTag(local).toLowerCase();
    if (SYSTEM_EMAIL_LOCALS.has(localBase)) {
      reasons.push(`email:local=${localBase}`);
    }

    if (domain && AUTOMATION_DOMAINS.has(domain)) {
      reasons.push(`email:domain=${domain}`);
    }
  }

  return { isNoise: reasons.length > 0, reasons };
}

/**
 * Boolean convenience wrapper.
 */
export function isNoiseContact(input: NoiseInput): boolean {
  return classifyNoiseContact(input).isNoise;
}

function parseEmail(email: string): { local: string; domain: string } | null {
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  return { local, domain };
}

function stripPlusTag(local: string): string {
  const plus = local.indexOf("+");
  return plus > 0 ? local.slice(0, plus) : local;
}
