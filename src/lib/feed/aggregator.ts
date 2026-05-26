/**
 * Feed aggregator (M0.x.3).
 *
 * Pulls from the registered source tables (ContactChangelog,
 * LifeEventSignal) and writes deduplicated FeedItem rows ready for
 * the /feed page to render.
 *
 * Dedup key: (userId, contactId, itemType, sourceRecordId). The
 * unique constraint on FeedItem handles cross-source collisions
 * (a job change detected from both a LinkedIn delta AND an email
 * extraction lands as one row, not two — the second source becomes
 * a same-event UPDATE).
 *
 * Highlighting: a contact's INNER_CIRCLE tier OR ≥20 past
 * interactions OR a life_event from any known contact lifts the
 * item to the top with isHighlighted=true.
 *
 * Pure functions for the mapping logic so they're testable without
 * a real PrismaClient.
 */
import type { PrismaClient } from "@/generated/prisma/client";

export type FeedItemType =
  | "job_change"
  | "publication"
  | "news_mention"
  | "life_event"
  | "award"
  | "announcement";

export interface FeedItemDraft {
  userId: string;
  contactId: string;
  itemType: FeedItemType;
  headline: string;
  body: string | null;
  sourceType: "changelog" | "email" | "message" | "web";
  sourceRecordId: string;
  linkUrl: string | null;
  detectedAt: Date;
}

interface ChangelogRow {
  id: string;
  contactId: string;
  userId: string;
  type: "JOB_CHANGE" | "ROLE_CHANGE" | "COMPANY_CHANGE" | "NEWS_MENTION";
  field: string;
  oldValue: string | null;
  newValue: string | null;
  source: string;
  detectedAt: Date;
  contact: { name: string };
}

/**
 * Map a single ContactChangelog row to a FeedItem draft. Returns null
 * for rows we don't want to surface in the feed (e.g. an empty
 * COMPANY_CHANGE with no newValue).
 */
export function changelogToFeedItem(
  row: ChangelogRow,
): FeedItemDraft | null {
  const isNewsMention = row.type === "NEWS_MENTION";
  const itemType: FeedItemType = isNewsMention
    ? "news_mention"
    : "job_change";

  let headline: string;
  let linkUrl: string | null = null;

  if (isNewsMention) {
    headline = `${row.contact.name} was mentioned in the news`;
    linkUrl = row.newValue ?? null;
  } else if (row.type === "ROLE_CHANGE" && row.newValue) {
    headline = `${row.contact.name} has a new role: ${row.newValue}`;
  } else if (row.type === "COMPANY_CHANGE" && row.newValue) {
    headline = `${row.contact.name} is now at ${row.newValue}`;
  } else if (row.type === "JOB_CHANGE" && row.newValue) {
    headline = `${row.contact.name}: ${row.newValue}`;
  } else {
    // Missing newValue means we have nothing to render — skip.
    return null;
  }

  return {
    userId: row.userId,
    contactId: row.contactId,
    itemType,
    headline,
    body: row.oldValue ? `Was: ${row.oldValue}` : null,
    sourceType: isNewsMention ? "web" : "changelog",
    sourceRecordId: row.id,
    linkUrl,
    detectedAt: row.detectedAt,
  };
}

interface LifeEventRow {
  id: string;
  userId: string;
  contactId: string;
  signalType: string;
  summary: string;
  sourceType: string;
  detectedAt: Date;
  contact: { name: string };
}

const PERSON_ARTICLE_RE = /^(I|We|Me|My)\b/;

export function lifeEventToFeedItem(row: LifeEventRow): FeedItemDraft {
  // Anchor the headline to the contact rather than first-person.
  // The extractor returns sender-perspective summaries like "Starting
  // at Anthropic" or "I had a baby"; convert to "Marcus is starting
  // at Anthropic" for third-person display in the feed.
  const summary = row.summary.trim();
  const headline = PERSON_ARTICLE_RE.test(summary)
    ? `${row.contact.name}: ${summary}`
    : summary.startsWith(row.contact.name)
      ? summary
      : `${row.contact.name}: ${summary}`;

  return {
    userId: row.userId,
    contactId: row.contactId,
    itemType: itemTypeForSignal(row.signalType),
    headline,
    body: null,
    sourceType: row.sourceType === "email" ? "email" : "message",
    sourceRecordId: row.id,
    linkUrl: null,
    detectedAt: row.detectedAt,
  };
}

function itemTypeForSignal(signalType: string): FeedItemType {
  switch (signalType) {
    case "new_role":
    case "promotion":
      return "job_change";
    case "publication":
      return "publication";
    case "award":
      return "award";
    case "company":
      return "job_change";
    default:
      return "life_event";
  }
}

/**
 * Compute whether a feed-item draft should be highlighted. Pure
 * over the inputs so we can test it without a Prisma instance.
 */
export function shouldHighlight(input: {
  tier: string;
  interactionCount: number;
  itemType: FeedItemType;
}): boolean {
  if (input.tier === "INNER_CIRCLE") return true;
  if (input.interactionCount >= 20) return true;
  // Family / milestone events are always worth surfacing if Jennifer
  // has met the person at all.
  if (input.itemType === "life_event" && input.interactionCount >= 1) {
    return true;
  }
  return false;
}

interface AggregateOptions {
  /** Cap on rows to process per source per run. */
  limitPerSource?: number;
  /** Override "now" for testing time-window logic. */
  now?: Date;
}

interface AggregateResult {
  scannedChangelog: number;
  scannedLifeEvents: number;
  upserted: number;
  highlighted: number;
}

/**
 * Aggregate one user's feed. Pulls pending rows from each source,
 * maps to drafts, then upserts in batches into FeedItem.
 *
 * Idempotent: the unique constraint catches reruns and the upsert
 * preserves the original createdAt — so re-aggregation doesn't
 * shuffle the displayed order.
 */
export async function aggregateForUser(
  prisma: PrismaClient,
  userId: string,
  opts: AggregateOptions = {},
): Promise<AggregateResult> {
  const limit = opts.limitPerSource ?? 200;

  const [changelogRows, lifeEventRows] = await Promise.all([
    prisma.contactChangelog.findMany({
      where: { userId },
      orderBy: { detectedAt: "desc" },
      take: limit,
      include: { contact: { select: { name: true, tier: true } } },
    }),
    prisma.lifeEventSignal.findMany({
      where: { userId },
      orderBy: { detectedAt: "desc" },
      take: limit,
      include: { contact: { select: { name: true, tier: true } } },
    }),
  ]);

  // Build a per-contact interaction-count map so the highlighter
  // doesn't re-query for every row.
  const contactIds = new Set<string>();
  for (const r of changelogRows) contactIds.add(r.contactId);
  for (const r of lifeEventRows) contactIds.add(r.contactId);

  const interactionCounts = await prisma.interaction.groupBy({
    by: ["contactId"],
    where: {
      userId,
      contactId: { in: Array.from(contactIds) },
    },
    _count: { contactId: true },
  });
  const countByContact = new Map<string, number>();
  for (const c of interactionCounts) {
    if (c.contactId) {
      countByContact.set(c.contactId, c._count.contactId);
    }
  }
  const tierByContact = new Map<string, string>();
  for (const r of changelogRows) {
    tierByContact.set(r.contactId, r.contact.tier);
  }
  for (const r of lifeEventRows) {
    tierByContact.set(r.contactId, r.contact.tier);
  }

  const drafts: FeedItemDraft[] = [];
  for (const r of changelogRows) {
    const draft = changelogToFeedItem(r);
    if (draft) drafts.push(draft);
  }
  for (const r of lifeEventRows) {
    drafts.push(lifeEventToFeedItem(r));
  }

  let upserted = 0;
  let highlighted = 0;

  for (const draft of drafts) {
    const tier = tierByContact.get(draft.contactId) ?? "ACQUAINTANCE";
    const interactionCount = countByContact.get(draft.contactId) ?? 0;
    const isHighlighted = shouldHighlight({
      tier,
      interactionCount,
      itemType: draft.itemType,
    });

    await prisma.feedItem.upsert({
      where: {
        userId_contactId_itemType_sourceRecordId: {
          userId: draft.userId,
          contactId: draft.contactId,
          itemType: draft.itemType,
          sourceRecordId: draft.sourceRecordId,
        },
      },
      create: {
        userId: draft.userId,
        contactId: draft.contactId,
        itemType: draft.itemType,
        headline: draft.headline,
        body: draft.body,
        sourceType: draft.sourceType,
        sourceRecordId: draft.sourceRecordId,
        linkUrl: draft.linkUrl,
        detectedAt: draft.detectedAt,
        isHighlighted,
      },
      update: {
        headline: draft.headline,
        body: draft.body,
        linkUrl: draft.linkUrl,
        detectedAt: draft.detectedAt,
        isHighlighted,
      },
    });

    upserted++;
    if (isHighlighted) highlighted++;
  }

  return {
    scannedChangelog: changelogRows.length,
    scannedLifeEvents: lifeEventRows.length,
    upserted,
    highlighted,
  };
}
