export interface FollowUpContact {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  tier: string;
  avatarUrl: string | null;
  lastInteraction: Date | null;
  followUpDays: number | null;
  cadenceDays: number;
  daysOverdue: number;
  dueDate: Date;
  lastInteractionSummary: string | null;
  lastInteractionType: string | null;
}
