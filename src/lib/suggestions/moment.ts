/**
 * "Moment to Connect" — one carefully-chosen contact suggestion per day,
 * surfaced when the calendar shows a genuinely light moment.
 *
 * Design rules (from Phase 2.4 of the roadmap):
 *  - Hard cap: one suggestion per day. Never a list.
 *  - Only show when today actually has space (light schedule OR a 90+ min gap).
 *  - Pick deterministically per (user, date) so the same suggestion shows
 *    all day — refreshing the page never shuffles it.
 *  - Bias toward contacts that have history (interactionCount > 0) but
 *    have been quiet (15+ days since last interaction).
 *  - Strongly favor Inner Circle; fall back to Professional if no Inner
 *    Circle contact qualifies.
 *
 * Returns null when there's no qualifying day or no qualifying contact —
 * the UI hides the card entirely in that case rather than nagging.
 */

import { prisma } from "@/lib/prisma";
import type { UpcomingEvent } from "@/lib/calendar";

export interface MomentSuggestion {
  contactId: string;
  contactName: string;
  company: string | null;
  role: string | null;
  tier: string;
  avatarUrl: string | null;
  daysSinceLastInteraction: number | null;
  interactionCount: number;
  reason: string;
  sourceSystem: string;
  sourceRecordIds: string[];
  /** Hint for the UI: "light_day" | "gap_in_schedule". */
  occasion: "light_day" | "gap_in_schedule";
  /** ISO date the suggestion was picked for (the user's local date). */
  forDate: string;
}

const MIN_QUIET_DAYS = 15;
const MAX_QUIET_DAYS = 180; // beyond this they're dormant — different surface
const LIGHT_DAY_BUSY_HOURS = 4; // <4 hrs busy 9-5 = light day
const GAP_MINUTES_REQUIRED = 90;
const WORKDAY_START_HOUR = 9;
const WORKDAY_END_HOUR = 17;

/**
 * Pick at most one suggestion for the given day. todayLocal must be the
 * user's local date (YYYY-MM-DD); the caller is responsible for picking
 * the right timezone since we don't have it server-side. Defaults to UTC
 * if you're not opinionated.
 */
export async function pickMomentSuggestion(
  userId: string,
  todayEvents: UpcomingEvent[],
  todayLocal: string,
): Promise<MomentSuggestion | null> {
  const occasion = evaluateDayShape(todayEvents);
  if (!occasion) return null;

  const candidate = await pickContact(userId, todayLocal);
  if (!candidate) return null;

  return {
    ...candidate,
    occasion,
    forDate: todayLocal,
    reason: buildReason(candidate, occasion),
    sourceSystem: "calendar",
    sourceRecordIds: [
      `calendar:freebusy:${todayLocal}`,
      `contact:${candidate.contactId}`,
    ],
  };
}

/**
 * Return either "light_day" (under LIGHT_DAY_BUSY_HOURS busy 9–5),
 * "gap_in_schedule" (a contiguous 90+ minute window between meetings),
 * or null (the day is too packed to suggest interrupting).
 */
export function evaluateDayShape(
  events: UpcomingEvent[],
): MomentSuggestion["occasion"] | null {
  const today = new Date();
  const workdayStart = new Date(today);
  workdayStart.setHours(WORKDAY_START_HOUR, 0, 0, 0);
  const workdayEnd = new Date(today);
  workdayEnd.setHours(WORKDAY_END_HOUR, 0, 0, 0);

  // Convert events into busy intervals clipped to the workday window.
  const busy: Array<[number, number]> = [];
  for (const e of events) {
    const start = new Date(e.startTime).getTime();
    const end = e.endTime ? new Date(e.endTime).getTime() : start + 30 * 60_000;
    const clippedStart = Math.max(start, workdayStart.getTime());
    const clippedEnd = Math.min(end, workdayEnd.getTime());
    if (clippedEnd > clippedStart) busy.push([clippedStart, clippedEnd]);
  }

  busy.sort((a, b) => a[0] - b[0]);

  // Total busy minutes.
  let busyMs = 0;
  for (const [s, e] of busy) busyMs += e - s;
  const busyHours = busyMs / (1000 * 60 * 60);

  if (busyHours < LIGHT_DAY_BUSY_HOURS) return "light_day";

  // Look for a 90+ min gap between busy intervals.
  let cursor = workdayStart.getTime();
  for (const [s, e] of busy) {
    const gap = s - cursor;
    if (gap >= GAP_MINUTES_REQUIRED * 60_000) return "gap_in_schedule";
    cursor = Math.max(cursor, e);
  }
  // Tail gap from last meeting to end of workday.
  if (workdayEnd.getTime() - cursor >= GAP_MINUTES_REQUIRED * 60_000) {
    return "gap_in_schedule";
  }

  return null;
}

interface ContactCandidate {
  contactId: string;
  contactName: string;
  company: string | null;
  role: string | null;
  tier: string;
  avatarUrl: string | null;
  daysSinceLastInteraction: number;
  interactionCount: number;
}

/**
 * Pick one contact for today. Deterministic per (userId, date) — the
 * same user on the same day always gets the same suggestion. Bias:
 * Inner Circle first, then Professional. Within a tier, the
 * deterministic index runs across all candidates so we don't always
 * pick the alphabetically-first one.
 */
async function pickContact(
  userId: string,
  todayLocal: string,
): Promise<ContactCandidate | null> {
  const now = new Date();
  const minLast = new Date(now.getTime() - MAX_QUIET_DAYS * 86400_000);
  const maxLast = new Date(now.getTime() - MIN_QUIET_DAYS * 86400_000);

  // Pull qualifying Inner Circle contacts first, then Professional if
  // none qualify. Acquaintance excluded — too noisy.
  const tiers = ["INNER_CIRCLE", "PROFESSIONAL"] as const;
  for (const tier of tiers) {
    const candidates = await prisma.contact.findMany({
      where: {
        userId,
        tier,
        lastInteraction: { gte: minLast, lte: maxLast },
      },
      select: {
        id: true,
        name: true,
        company: true,
        role: true,
        tier: true,
        avatarUrl: true,
        lastInteraction: true,
        _count: { select: { interactions: true } },
      },
      orderBy: { name: "asc" }, // stable input order for deterministic hash
    });

    const qualified = candidates.filter((c) => c._count.interactions > 0);
    if (qualified.length === 0) continue;

    const idx = stableHash(`${userId}|${todayLocal}`) % qualified.length;
    const pick = qualified[idx];

    return {
      contactId: pick.id,
      contactName: pick.name,
      company: pick.company,
      role: pick.role,
      tier: pick.tier,
      avatarUrl: pick.avatarUrl,
      daysSinceLastInteraction: Math.floor(
        (now.getTime() - pick.lastInteraction!.getTime()) / 86400_000,
      ),
      interactionCount: pick._count.interactions,
    };
  }

  return null;
}

function buildReason(
  c: ContactCandidate,
  occasion: MomentSuggestion["occasion"],
): string {
  const tierLabel = c.tier === "INNER_CIRCLE" ? "Inner circle" : "Professional";
  const occasionLabel =
    occasion === "light_day" ? "Light day today" : "Open window today";
  return `${occasionLabel} · ${tierLabel} · Quiet ${c.daysSinceLastInteraction}d`;
}

/**
 * djb2 string hash. Fast, deterministic, non-cryptographic. We only need
 * stable bucketing — not security.
 */
function stableHash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h * 33) ^ input.charCodeAt(i)) >>> 0;
  }
  return h;
}
