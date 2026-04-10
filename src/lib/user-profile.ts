/**
 * User-specific configuration for AI prompts, draft generation, and templates.
 * Override these per-deployment via environment variables or by editing
 * this file on a user branch.
 */
export interface UserProfile {
  /** User's first name (used in draft sign-offs and AI prompts) */
  firstName: string;
  /** User's full name */
  fullName: string;
  /** Brief description for AI system prompts (who is this person?) */
  bio: string;
  /** How they sign professional emails (e.g., "Best, Devon") */
  emailSignoff: string;
  /** Whether to include a sign-off on casual messages (texts, WhatsApp) */
  casualSignoff: boolean;
  /** Communication style guidance for AI drafts */
  style: string;
  /** Phrases the user NEVER wants in generated drafts */
  bannedPhrases: string[];
  /** Default channels this deployment syncs (used in auto-sync and health checks) */
  activeChannels: Array<"gmail" | "linkedin" | "whatsapp" | "imessage" | "calendar">;
  /** Whether iMessage/chat.db sync is available (requires Mac with Messages.app) */
  imessageAvailable: boolean;
}

const DEFAULT_PROFILE: UserProfile = {
  firstName: process.env.CRM_USER_FIRST_NAME || "INSERT_MOMS_FIRST_NAME",
  fullName: process.env.CRM_USER_FULL_NAME || "INSERT_MOMS_FULL_NAME",
  bio: process.env.CRM_USER_BIO || "INSERT_SHORT_BIO",
  emailSignoff: process.env.CRM_USER_EMAIL_SIGNOFF || "Love, INSERT_MOMS_FIRST_NAME",
  casualSignoff: false,
  style:
    process.env.CRM_USER_STYLE ||
    "warm and caring, writes in complete sentences, uses proper punctuation, a bit more formal than texting shorthand",
  bannedPhrases: [
    "Hope this finds you well",
    "Per my last email",
    "Circle back",
    "Touch base",
  ],
  activeChannels: ["gmail", "calendar"],
  imessageAvailable: false,
};

let _profile: UserProfile = { ...DEFAULT_PROFILE };

export function getUserProfile(): UserProfile {
  return _profile;
}

/**
 * Override profile values. Call this at app startup or in tests.
 */
export function setUserProfile(overrides: Partial<UserProfile>): void {
  _profile = { ...DEFAULT_PROFILE, ...overrides };
}
