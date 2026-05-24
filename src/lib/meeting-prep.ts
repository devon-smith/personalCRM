/**
 * Meeting prep dossier — gathers three layers of context about each
 * attendee:
 *   1. Your history (CRM-internal: prior interactions, journal entries,
 *      drafts, changelog).
 *   2. Their public scholarly activity (OpenAlex; Crossref fallback).
 *   3. Open web — added in Commit B (web search integration).
 *
 * Each section is independently fetched + populated, so OpenAlex
 * downtime never blocks the CRM-history section. The shape is built
 * to be UI-ready: the prep page renders these structs verbatim.
 */

import { prisma } from "@/lib/prisma";
import {
  searchAuthors,
  getAuthorWithRecentWorks,
  type OpenAlexAuthor,
  type OpenAlexWork,
} from "./research/openalex";
import { searchContactWeb, type WebSearchResult } from "./research/web-search";

export interface AttendeePrep {
  contactId: string;
  contactName: string;
  email: string | null;
  role: string | null;
  company: string | null;
  avatarUrl: string | null;

  history: HistorySection;
  scholarly: ScholarlySection | null;
  openWeb: WebSearchResult | null;
  lastMeetingDelta: LastMeetingDelta | null;
}

export interface HistorySection {
  totalInteractions: number;
  lastInteractionAt: string | null;
  recentInteractions: Array<{
    id: string;
    type: string;
    direction: string;
    occurredAt: string;
    subject: string | null;
    summary: string | null;
  }>;
  recentJournal: Array<{
    id: string;
    content: string;
    mood: string;
    createdAt: string;
  }>;
  recentLifeUpdates: Array<{
    id: string;
    type: string;
    field: string;
    oldValue: string | null;
    newValue: string | null;
    detectedAt: string;
  }>;
}

export interface ScholarlySection {
  authorId: string;
  authorName: string;
  hIndex: number | null;
  worksCount: number;
  citedByCount: number;
  currentInstitution: string | null;
  recentWorks: OpenAlexWork[];
  /** True if more than one OpenAlex author matched the name — UI should
   *  let the user disambiguate. */
  candidatesFound: number;
}

export interface LastMeetingDelta {
  lastMeetingAt: string;
  daysSince: number;
  /** Heuristic: counts CRM events worth surfacing since that meeting. */
  changesSinceCount: number;
}

export interface MeetingPrepDossier {
  eventId: string;
  attendees: AttendeePrep[];
}

/**
 * Build the full dossier for every attendee whose email matches a contact.
 * Unknown attendees are skipped — prep for a stranger is the next milestone.
 */
export async function buildMeetingPrep(
  userId: string,
  eventId: string,
  attendeeEmails: string[],
): Promise<MeetingPrepDossier> {
  const lowercased = attendeeEmails.map((e) => e.toLowerCase()).filter(Boolean);
  if (lowercased.length === 0) {
    return { eventId, attendees: [] };
  }

  // Resolve emails → contacts. Checks both primary and additional emails.
  const contacts = await prisma.contact.findMany({
    where: {
      userId,
      OR: [
        { email: { in: lowercased, mode: "insensitive" } },
        { additionalEmails: { hasSome: lowercased } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      company: true,
      avatarUrl: true,
      openAlexAuthorId: true,
    },
  });

  // Wrap each section in a per-attendee catch so one section throwing
  // (Voyage outage, OpenAlex hiccup, Prisma weirdness) doesn't 500
  // the entire endpoint — the user sees the rest of the dossier with
  // the affected section showing an empty / null state.
  const attendees = await Promise.all(
    contacts.map(async (c) => {
      const [history, lastMeeting, scholarly, openWeb] = await Promise.all([
        loadHistory(userId, c.id).catch((err) => {
          console.error(`[meeting-prep] loadHistory failed for ${c.name}:`, err);
          return emptyHistory();
        }),
        loadLastMeetingDelta(userId, c.id).catch((err) => {
          console.error(`[meeting-prep] loadLastMeetingDelta failed for ${c.name}:`, err);
          return null;
        }),
        loadScholarly(c.id, c.name, c.openAlexAuthorId).catch((err) => {
          console.error(`[meeting-prep] loadScholarly failed for ${c.name}:`, err);
          return null;
        }),
        loadOpenWeb(userId, c.id, c.name, c.company).catch((err) => {
          console.error(`[meeting-prep] loadOpenWeb failed for ${c.name}:`, err);
          return null;
        }),
      ]);
      return {
        contactId: c.id,
        contactName: c.name,
        email: c.email,
        role: c.role,
        company: c.company,
        avatarUrl: c.avatarUrl,
        history,
        scholarly,
        openWeb,
        lastMeetingDelta: lastMeeting,
      } as AttendeePrep;
    }),
  );

  return { eventId, attendees };
}

function emptyHistory(): HistorySection {
  return {
    totalInteractions: 0,
    lastInteractionAt: null,
    recentInteractions: [],
    recentJournal: [],
    recentLifeUpdates: [],
  };
}

async function loadHistory(userId: string, contactId: string): Promise<HistorySection> {
  const [totalInteractions, recent, journal, changelog] = await Promise.all([
    prisma.interaction.count({ where: { contactId, userId } }),
    prisma.interaction.findMany({
      where: { contactId, userId },
      orderBy: { occurredAt: "desc" },
      take: 5,
      select: {
        id: true,
        type: true,
        direction: true,
        occurredAt: true,
        subject: true,
        summary: true,
      },
    }),
    prisma.journalEntry.findMany({
      where: { contactId, userId },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { id: true, content: true, mood: true, createdAt: true },
    }),
    prisma.contactChangelog.findMany({
      where: { contactId, status: { in: ["PENDING", "SEEN"] } },
      orderBy: { detectedAt: "desc" },
      take: 5,
      select: {
        id: true,
        type: true,
        field: true,
        oldValue: true,
        newValue: true,
        detectedAt: true,
      },
    }),
  ]);

  return {
    totalInteractions,
    lastInteractionAt: recent[0]?.occurredAt.toISOString() ?? null,
    recentInteractions: recent.map((i) => ({
      id: i.id,
      type: i.type,
      direction: i.direction,
      occurredAt: i.occurredAt.toISOString(),
      subject: i.subject,
      summary: i.summary,
    })),
    recentJournal: journal.map((j) => ({
      id: j.id,
      content: j.content,
      mood: String(j.mood),
      createdAt: j.createdAt.toISOString(),
    })),
    recentLifeUpdates: changelog.map((c) => ({
      id: c.id,
      type: c.type,
      field: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
      detectedAt: c.detectedAt.toISOString(),
    })),
  };
}

async function loadLastMeetingDelta(
  userId: string,
  contactId: string,
): Promise<LastMeetingDelta | null> {
  // Find the most recent MEETING-type interaction for this contact —
  // that's the "last time we sat down together" anchor.
  const lastMeeting = await prisma.interaction.findFirst({
    where: { contactId, userId, type: "MEETING" },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  if (!lastMeeting) return null;

  const since = lastMeeting.occurredAt;
  const daysSince = Math.floor((Date.now() - since.getTime()) / 86_400_000);

  const changesSinceCount = await prisma.interaction.count({
    where: {
      contactId,
      userId,
      occurredAt: { gt: since },
    },
  });

  return {
    lastMeetingAt: since.toISOString(),
    daysSince,
    changesSinceCount,
  };
}

async function loadScholarly(
  contactId: string,
  name: string,
  pinnedAuthorId: string | null,
): Promise<ScholarlySection | null> {
  try {
    // Pinned: prior prep flow already disambiguated this contact.
    if (pinnedAuthorId) {
      const result = await getAuthorWithRecentWorks(pinnedAuthorId, 5);
      if (!result) return null;
      return toScholarlySection(result.author, result.works, 1);
    }

    // Otherwise search OpenAlex; auto-pin only when there's a clear winner.
    const candidates = await searchAuthors(name);
    if (candidates.length === 0) return null;

    // Auto-pin heuristic: top candidate has 5x more works than the next.
    // Otherwise leave it to the UI to disambiguate.
    const top = candidates[0];
    const isClearWinner =
      candidates.length === 1 ||
      (candidates[1] && top.worksCount >= 5 * Math.max(candidates[1].worksCount, 1));

    if (isClearWinner) {
      await prisma.contact.update({
        where: { id: contactId },
        data: {
          openAlexAuthorId: top.id,
          orcid: top.orcid,
          scholarlyProfileMatchedAt: new Date(),
        },
      });
      const detail = await getAuthorWithRecentWorks(top.id, 5);
      if (!detail) return null;
      return toScholarlySection(detail.author, detail.works, candidates.length);
    }

    // Ambiguous — return enough info for the UI to ask which one.
    return {
      authorId: "",
      authorName: name,
      hIndex: null,
      worksCount: 0,
      citedByCount: 0,
      currentInstitution: null,
      recentWorks: [],
      candidatesFound: candidates.length,
    };
  } catch (err) {
    console.error(`[meeting-prep] OpenAlex lookup failed for ${name}:`, err);
    return null;
  }
}

async function loadOpenWeb(
  userId: string,
  contactId: string,
  name: string,
  company: string | null,
): Promise<WebSearchResult | null> {
  try {
    return await searchContactWeb({ userId, contactId, name, company });
  } catch (err) {
    // Web search failure must not break the rest of the dossier.
    console.error(`[meeting-prep] web search failed for ${name}:`, err);
    return null;
  }
}

function toScholarlySection(
  author: OpenAlexAuthor,
  works: OpenAlexWork[],
  candidatesFound: number,
): ScholarlySection {
  return {
    authorId: author.id,
    authorName: author.displayName,
    hIndex: author.hIndex,
    worksCount: author.worksCount,
    citedByCount: author.citedByCount,
    currentInstitution: author.lastKnownInstitution?.displayName ?? null,
    recentWorks: works,
    candidatesFound,
  };
}
