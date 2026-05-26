/**
 * Daily assistant-observations generation (M9.2).
 *
 * Walks recent signals — inbound emails Jennifer hasn't replied to,
 * open threads gone stale, recent ContactChangelog life events,
 * dormant INNER_CIRCLE contacts — and produces 1-2 conversational
 * one-liners for the dashboard "Notes from your assistant" surface.
 *
 * Per the plan: "I noticed you haven't replied to David — he asked
 * something specific about your paper." Not a notification, not a
 * todo. A peer's mention.
 *
 * Pure for the signal selection + phrasing. The worker handles DB
 * reads + writes; this module just turns signals into observations.
 */

import type { PrismaClient } from "@/generated/prisma/client";

export interface Signal {
  source: string; // "unanswered_inbound", "stale_open_thread", etc.
  contactId: string;
  contactName: string;
  /** Free-form data the phrasing step uses. */
  detail: string;
  /** Source-record IDs for provenance. */
  refs: string[];
  /** When the underlying event occurred — used for sort + dedup. */
  observedAt: Date;
}

export interface ObservationDraft {
  content: string;
  contactId: string;
  source: string;
  sourceRefs: string[];
}

const SIGNAL_LOOKBACK_DAYS = 14;
const MAX_OBSERVATIONS_PER_RUN = 3;
const UNANSWERED_MIN_AGE_DAYS = 3;

/**
 * Top-level signal collector. Pulls from each source in parallel,
 * dedups by contactId (one observation per person per run, even if
 * multiple signals fire), ranks, and returns the top N for phrasing.
 */
export async function collectSignals(
  prisma: PrismaClient,
  userId: string,
): Promise<Signal[]> {
  const cutoff = new Date(
    Date.now() - SIGNAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );
  const unansweredCutoff = new Date(
    Date.now() - UNANSWERED_MIN_AGE_DAYS * 24 * 60 * 60 * 1000,
  );

  const [unanswered, staleThreads, lifeEvents, dormantInnerCircle] =
    await Promise.all([
      findUnansweredInbound(prisma, userId, unansweredCutoff),
      findStaleOpenThreads(prisma, userId),
      findRecentLifeEvents(prisma, userId, cutoff),
      findDormantInnerCircle(prisma, userId),
    ]);

  const all = [...unanswered, ...staleThreads, ...lifeEvents, ...dormantInnerCircle];

  // Dedup by contactId — most-impactful signal per person wins.
  // Priority order (highest first): unanswered_inbound, stale_open_thread,
  // recent_life_event, dormant_inner_circle.
  const SOURCE_PRIORITY = [
    "unanswered_inbound",
    "stale_open_thread",
    "recent_life_event",
    "dormant_inner_circle",
  ];
  const byContact = new Map<string, Signal>();
  for (const sig of all) {
    const prev = byContact.get(sig.contactId);
    if (!prev) {
      byContact.set(sig.contactId, sig);
      continue;
    }
    if (
      SOURCE_PRIORITY.indexOf(sig.source) < SOURCE_PRIORITY.indexOf(prev.source)
    ) {
      byContact.set(sig.contactId, sig);
    }
  }

  // Sort by observedAt desc, take top N.
  return Array.from(byContact.values())
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())
    .slice(0, MAX_OBSERVATIONS_PER_RUN);
}

// ─── Signal sources ────────────────────────────────────────

async function findUnansweredInbound(
  prisma: PrismaClient,
  userId: string,
  cutoff: Date,
): Promise<Signal[]> {
  // INBOUND email older than 3 days that the user genuinely hasn't
  // responded to. `needsReply=true` is the entry filter, but that
  // flag is set at email-arrival time and doesn't update when the
  // user replies — so we additionally drop any candidate that has a
  // later OUTBOUND in the same threadId. Without this, observations
  // pile up about emails Jennifer answered weeks ago. (M0.5.)
  const candidates = await prisma.interaction.findMany({
    where: {
      userId,
      direction: "INBOUND",
      type: "EMAIL",
      occurredAt: { lt: cutoff },
      needsReply: true,
      dismissedAt: null,
    },
    orderBy: { occurredAt: "desc" },
    // Over-fetch — the threadId post-filter will drop a chunk.
    take: 50,
    select: {
      id: true,
      contactId: true,
      threadId: true,
      subject: true,
      needsReplyReason: true,
      occurredAt: true,
      contact: { select: { name: true } },
    },
  });

  const live = await dropAnsweredByThread(prisma, userId, candidates);

  return live.slice(0, 20).map((c) => ({
    source: "unanswered_inbound",
    contactId: c.contactId,
    contactName: c.contact.name,
    detail: c.subject ?? c.needsReplyReason ?? "their last message",
    refs: [`interaction:${c.id}`],
    observedAt: c.occurredAt,
  }));
}

interface ThreadCandidate {
  id: string;
  threadId: string | null;
  occurredAt: Date;
}

/**
 * Filter out candidates that have a later OUTBOUND interaction in the
 * same thread — Jennifer already replied.
 *
 * Exported for the /api/observations route to re-check persisted
 * observations at render time; once a row is created we still want
 * to suppress it from the dashboard once the user replies, even
 * before the next observation-generation run.
 */
export async function dropAnsweredByThread<T extends ThreadCandidate>(
  prisma: PrismaClient,
  userId: string,
  candidates: T[],
): Promise<T[]> {
  if (candidates.length === 0) return [];

  const threadIds = candidates
    .map((c) => c.threadId)
    .filter((t): t is string => typeof t === "string" && t.length > 0);

  if (threadIds.length === 0) return candidates;

  const outbounds = await prisma.interaction.findMany({
    where: {
      userId,
      threadId: { in: threadIds },
      direction: "OUTBOUND",
    },
    select: { threadId: true, occurredAt: true },
  });

  // Latest OUTBOUND per thread — only need the max for the comparison.
  const latestOutbound = new Map<string, Date>();
  for (const o of outbounds) {
    if (!o.threadId) continue;
    const prev = latestOutbound.get(o.threadId);
    if (!prev || o.occurredAt > prev) {
      latestOutbound.set(o.threadId, o.occurredAt);
    }
  }

  return candidates.filter((c) => {
    if (!c.threadId) return true;
    const out = latestOutbound.get(c.threadId);
    return !out || out <= c.occurredAt;
  });
}

async function findStaleOpenThreads(
  prisma: PrismaClient,
  userId: string,
): Promise<Signal[]> {
  // ContactMemory.openThreads with status="stale". Each memory row
  // can have multiple; emit one signal per memory (the most recent
  // stale thread).
  const memories = await prisma.contactMemory.findMany({
    where: { contact: { userId } },
    select: {
      contactId: true,
      openThreads: true,
      contact: { select: { name: true } },
    },
  });
  const signals: Signal[] = [];
  for (const m of memories) {
    const threads = Array.isArray(m.openThreads)
      ? (m.openThreads as Array<Record<string, unknown>>)
      : [];
    const staleThreads = threads
      .filter((t) => t.status === "stale" && typeof t.subject === "string")
      .sort((a, b) =>
        String(b.raisedAt ?? "").localeCompare(String(a.raisedAt ?? "")),
      );
    if (staleThreads.length === 0) continue;
    const top = staleThreads[0];
    signals.push({
      source: "stale_open_thread",
      contactId: m.contactId,
      contactName: m.contact.name,
      detail: `${top.raisedBy === "them" ? "they asked about" : "you mentioned"} ${top.subject}`,
      refs: [`memory:${m.contactId}`],
      observedAt: top.raisedAt
        ? new Date(String(top.raisedAt))
        : new Date(0),
    });
  }
  return signals;
}

async function findRecentLifeEvents(
  prisma: PrismaClient,
  userId: string,
  cutoff: Date,
): Promise<Signal[]> {
  // ContactChangelog rows from the last lookback window with types
  // that suggest a life-update worth acknowledging.
  const events = await prisma.contactChangelog.findMany({
    where: {
      contact: { userId },
      detectedAt: { gte: cutoff },
      status: { in: ["PENDING", "SEEN"] },
      type: {
        in: ["JOB_CHANGE", "ROLE_CHANGE", "COMPANY_CHANGE", "NEWS_MENTION"],
      },
    },
    orderBy: { detectedAt: "desc" },
    take: 20,
    select: {
      id: true,
      contactId: true,
      type: true,
      field: true,
      oldValue: true,
      newValue: true,
      detectedAt: true,
      contact: { select: { name: true } },
    },
  });
  return events.map((e) => ({
    source: "recent_life_event",
    contactId: e.contactId,
    contactName: e.contact.name,
    detail: lifeEventDetail(e),
    refs: [`changelog:${e.id}`],
    observedAt: e.detectedAt,
  }));
}

async function findDormantInnerCircle(
  prisma: PrismaClient,
  userId: string,
): Promise<Signal[]> {
  // INNER_CIRCLE contacts whose lastInteraction is >90 days ago.
  // "You haven't talked to <person> in three months" is a real
  // observation worth surfacing for relationships the user has
  // explicitly marked important.
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const contacts = await prisma.contact.findMany({
    where: {
      userId,
      tier: "INNER_CIRCLE",
      lastInteraction: { lt: cutoff },
    },
    orderBy: { lastInteraction: "asc" }, // oldest first
    take: 5,
    select: { id: true, name: true, lastInteraction: true },
  });
  return contacts.map((c) => ({
    source: "dormant_inner_circle",
    contactId: c.id,
    contactName: c.name,
    detail: c.lastInteraction
      ? `you haven't connected since ${c.lastInteraction.toISOString().slice(0, 10)}`
      : "you haven't connected in a while",
    refs: [`contact:${c.id}`],
    observedAt: c.lastInteraction ?? new Date(0),
  }));
}

// ─── Phrasing (pure) ───────────────────────────────────────

/**
 * Turn a Signal into a one-sentence ObservationDraft.
 * Phrasing rules from the plan: peer-like, not a todo, never urgent.
 * Lowercase first letter of detail when it follows our opener.
 */
export function phraseSignal(sig: Signal): ObservationDraft {
  const firstName = sig.contactName.split(" ")[0];
  let content: string;
  switch (sig.source) {
    case "unanswered_inbound":
      content = `${firstName} asked about ${stripQuotes(sig.detail)} a few days ago — still open on your side.`;
      break;
    case "stale_open_thread":
      content = `Open thread with ${firstName}: ${sig.detail}. Hasn't moved in a while.`;
      break;
    case "recent_life_event":
      content = `${firstName} ${sig.detail}.`;
      break;
    case "dormant_inner_circle":
      content = `${firstName}'s in your inner circle; ${sig.detail}.`;
      break;
    default:
      content = `${firstName}: ${sig.detail}.`;
  }
  return {
    content,
    contactId: sig.contactId,
    source: sig.source,
    sourceRefs: sig.refs,
  };
}

function stripQuotes(s: string): string {
  return s.replace(/^"|"$/g, "").trim();
}

/**
 * Map a ContactChangelog row to user-facing phrasing.
 *
 * Key constraint: NEVER expose raw enum strings (the `field` column
 * carries internal labels like "web_mention", "company_field" that
 * leak into copy when used directly). Pull from the human-facing
 * data fields (oldValue/newValue) and fall back to generic phrasing
 * rather than the field name.
 *
 * Schema convention from signal-detection.ts:
 *   NEWS_MENTION  → oldValue: article title, newValue: URL
 *   JOB_CHANGE    → newValue: new company
 *   COMPANY_CHANGE → newValue: new company
 *   ROLE_CHANGE   → newValue: new title
 */
export function lifeEventDetail(e: {
  type: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}): string {
  switch (e.type) {
    case "JOB_CHANGE":
    case "COMPANY_CHANGE":
      return `is now at ${e.newValue ?? "a new role"}`;
    case "ROLE_CHANGE":
      return `has a new role: ${e.newValue ?? "title updated"}`;
    case "NEWS_MENTION": {
      // oldValue holds the article title (per signal-detection.ts).
      // Use it directly when present, never expose the enum-y `field`
      // column which leaked "web_mention" into earlier observations.
      const title = e.oldValue?.trim();
      if (title && title.length > 0) {
        const shown = title.length > 70 ? title.slice(0, 67) + "…" : title;
        return `was mentioned recently — "${shown}"`;
      }
      return "was mentioned in the news recently";
    }
    default:
      // Don't reference `field` here either — same enum-leak risk.
      return "had a recent life update";
  }
}
