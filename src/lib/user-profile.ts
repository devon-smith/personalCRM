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
  firstName: process.env.CRM_USER_FIRST_NAME || "Devon",
  fullName: process.env.CRM_USER_FULL_NAME || "Devon Smith",
  bio: process.env.CRM_USER_BIO || "a Stanford MS CS student",
  emailSignoff: process.env.CRM_USER_EMAIL_SIGNOFF || "Best, Devon",
  casualSignoff: false,
  style:
    process.env.CRM_USER_STYLE ||
    "casual but thoughtful, uses first names, doesn't use formal openers",
  bannedPhrases: [
    "Hope this finds you well",
    "I wanted to reach out",
    "Per my last email",
    "Circle back",
    "Touch base",
    "Hope you're doing well",
  ],
  activeChannels: ["gmail", "linkedin", "calendar"],
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
