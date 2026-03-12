/**
 * Circle template definitions.
 * Safe to import from client components — no server dependencies.
 */

export interface CircleTemplate {
  name: string;
  color: string;
  icon: string;
  followUpDays: number;
  description: string;
}

/** Pre-built circle templates for onboarding selection */
export const CIRCLE_TEMPLATES: readonly CircleTemplate[] = [
  {
    name: "Inner Circle",
    color: "#10B981",
    icon: "heart",
    followUpDays: 7,
    description: "Best friends, partner, parents — your closest people",
  },
  {
    name: "Stanford",
    color: "#EF4444",
    icon: "graduation-cap",
    followUpDays: 21,
    description: "Lab mates, BASES crew, Stanford friends",
  },
  {
    name: "Goldman",
    color: "#F59E0B",
    icon: "briefcase",
    followUpDays: 30,
    description: "S&T desk, mentors, Goldman colleagues",
  },
  {
    name: "VC Network",
    color: "#8B5CF6",
    icon: "network",
    followUpDays: 30,
    description: "Partners, founders, investors",
  },
  {
    name: "Family",
    color: "#F97316",
    icon: "users",
    followUpDays: 14,
    description: "Siblings, cousins, aunts, uncles",
  },
  {
    name: "Acquaintances",
    color: "#94A3B8",
    icon: "globe",
    followUpDays: 90,
    description: "Conference contacts, one-off intros",
  },
] as const;

/** The default circles seeded for new users */
export const DEFAULT_CIRCLES: readonly CircleTemplate[] = CIRCLE_TEMPLATES;
