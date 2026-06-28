/**
 * Smart Circle Suggestions
 *
 * Suggests meaningful life-category circles (education, work, friends)
 * based on contact data and interaction patterns.
 */

import { prisma } from "./prisma";

// ─── Types ──────────────────────────────────────────────────

export interface SuggestionContact {
  readonly id: string;
  readonly name: string;
  readonly company: string | null;
}

export interface CircleSuggestion {
  readonly id: string;
  readonly name: string;
  readonly reason: SuggestionReason;
  readonly description: string;
  readonly contactIds: readonly string[];
  readonly contactCount: number;
  readonly existingCircle: { readonly id: string; readonly name: string } | null;
  readonly suggestedCadence: number;
  readonly contacts: readonly SuggestionContact[];
}

export type SuggestionReason =
  | "communication_group"
  | "education"
  | "work"
  | "frequent_interaction"
  | "company_overlap"
  | "geographic";

interface ContactWithMeta {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly company: string | null;
  readonly role: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly country: string | null;
  readonly source: string;
}

interface ExistingCircle {
  readonly id: string;
  readonly name: string;
}

// ─── Education domain detection ─────────────────────────────

const EDUCATION_SUFFIXES = [
  ".edu", ".ac.uk", ".edu.au", ".edu.cn", ".edu.sg",
];

function isEducationDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return EDUCATION_SUFFIXES.some((suffix) => domain.endsWith(suffix));
}

const EDUCATION_KEYWORDS =
  /\b(university|college|school|institute|academy|alumni|student|professor|faculty|dean|provost|stanford|harvard|mit|yale|princeton|columbia|berkeley|ucla|nyu|upenn|cornell|brown|dartmouth|duke|georgetown|uchicago|caltech|georgia tech|umich|uva|wharton)\b/i;

// ─── Generic email domains to ignore ────────────────────────

const GENERIC_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "icloud.com", "me.com", "aol.com", "live.com", "protonmail.com",
  "mail.com", "msn.com", "ymail.com", "comcast.net", "att.net",
  "verizon.net", "sbcglobal.net", "cox.net", "pm.me",
  "googlemail.com", "fastmail.com",
]);

// ─── Main function ──────────────────────────────────────────

export async function generateCircleSuggestions(
  userId: string,
): Promise<CircleSuggestion[]> {
  const allContacts = await prisma.contact.findMany({
    where: { userId },
    select: {
      id: true, name: true, email: true, company: true,
      role: true, source: true,
      city: true, state: true, country: true,
      circles: { select: { circleId: true } },
    },
  });

  const uncircled: ContactWithMeta[] = allContacts
    .filter((c) => c.circles.length === 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      company: c.company,
      role: c.role,
      city: c.city,
      state: c.state,
      country: c.country,
      source: c.source,
    }));

  if (uncircled.length === 0) return [];

  const circles = await prisma.circle.findMany({
    where: { userId },
    select: { id: true, name: true },
  });

  // Interaction frequency for cadence + friends signal
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const interactionCounts = await prisma.interaction.groupBy({
    by: ["contactId"],
    where: { userId, occurredAt: { gte: ninetyDaysAgo } },
    _count: { _all: true },
  });
  const frequencyMap = new Map(
    interactionCounts.map((r) => [r.contactId, r._count._all]),
  );

  const suggestions: CircleSuggestion[] = [];
  const assignedIds = new Set<string>();
  const uncircledById = new Map(uncircled.map((c) => [c.id, c]));

  // ── Signal 0: Communication groups ──
  // Prefer people who repeatedly appear in the same recent thread.
  // This is closer to how users think about relationship circles than
  // static metadata like school, company, or city.
  const communicationSuggestions = await buildCommunicationGroupSuggestions({
    userId,
    uncircledById,
    circles,
  });
  for (const suggestion of communicationSuggestions) {
    suggestions.push(suggestion);
    suggestion.contactIds.forEach((id) => assignedIds.add(id));
  }

  // ── Signal 1: Education circle ──
  // Contacts with .edu emails or education-related companies/roles
  const educationContacts = uncircled.filter((c) => {
    if (c.email && isEducationDomain(c.email)) return true;
    if (c.company && EDUCATION_KEYWORDS.test(c.company)) return true;
    if (c.role && EDUCATION_KEYWORDS.test(c.role)) return true;
    return false;
  });

  if (educationContacts.length >= 2) {
    const ids = educationContacts.map((c) => c.id);
    const matchingCircle = findMatchingCircle("Education", circles)
      ?? findMatchingCircle("School", circles)
      ?? findMatchingCircle("University", circles)
      ?? findMatchingCircle("College", circles);

    suggestions.push({
      id: "signal:education",
      name: matchingCircle?.name ?? "Education",
      reason: "education",
      description: `${educationContacts.length} contacts from schools or universities`,
      contactIds: ids,
      contactCount: educationContacts.length,
      existingCircle: matchingCircle,
      suggestedCadence: 30,
      contacts: educationContacts.map((c) => ({
        id: c.id, name: c.name, company: c.company,
      })),
    });

    ids.forEach((id) => assignedIds.add(id));
  }

  // ── Signal 2: Work circle ──
  // Contacts with work email domains (non-generic, non-edu) grouped by domain
  const workDomainGroups = new Map<string, ContactWithMeta[]>();
  for (const c of uncircled) {
    if (assignedIds.has(c.id)) continue;
    if (!c.email) continue;
    const domain = c.email.split("@")[1]?.toLowerCase();
    if (!domain || GENERIC_DOMAINS.has(domain)) continue;
    if (isEducationDomain(c.email)) continue;

    const existing = workDomainGroups.get(domain) ?? [];
    existing.push(c);
    workDomainGroups.set(domain, existing);
  }

  // Merge work-domain contacts with 2+ from the same domain
  const workContacts: ContactWithMeta[] = [];
  for (const [, group] of workDomainGroups) {
    if (group.length >= 2) {
      workContacts.push(...group);
    }
  }

  if (workContacts.length >= 2) {
    const ids = workContacts.map((c) => c.id);
    const matchingCircle = findMatchingCircle("Work", circles)
      ?? findMatchingCircle("Professional", circles)
      ?? findMatchingCircle("Colleagues", circles);

    suggestions.push({
      id: "signal:work",
      name: matchingCircle?.name ?? "Work",
      reason: "work",
      description: `${workContacts.length} contacts from your work email domains`,
      contactIds: ids,
      contactCount: workContacts.length,
      existingCircle: matchingCircle,
      suggestedCadence: 14,
      contacts: workContacts.map((c) => ({
        id: c.id, name: c.name, company: c.company,
      })),
    });

    ids.forEach((id) => assignedIds.add(id));
  }

  // ── Signal 2b: Company overlap (M0.x.14) ──
  // Group remaining uncircled contacts by their `company` field. Catches
  // contacts who don't share a work email domain (Google Contacts often
  // has personal-email-plus-company-name from LinkedIn imports). Only
  // surfaces companies with ≥3 contacts to avoid pollution from one-off
  // company strings.
  const companyGroups = new Map<string, ContactWithMeta[]>();
  for (const c of uncircled) {
    if (assignedIds.has(c.id)) continue;
    const company = normalizeCompany(c.company);
    if (!company) continue;
    const existing = companyGroups.get(company) ?? [];
    existing.push(c);
    companyGroups.set(company, existing);
  }

  // Emit one suggestion per company with ≥3 contacts, sorted by size.
  const companySuggestions = Array.from(companyGroups.entries())
    .filter(([, group]) => group.length >= 3)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 5); // cap at 5 to avoid drowning the UI

  for (const [companyKey, group] of companySuggestions) {
    const ids = group.map((c) => c.id);
    // Use the display-cased version of the company from the first
    // contact (avoids "stanford gsb" lowercase).
    const displayName = group[0].company?.trim() ?? companyKey;
    const matchingCircle = findMatchingCircle(displayName, circles);
    suggestions.push({
      id: `signal:company:${companyKey}`,
      name: matchingCircle?.name ?? displayName,
      reason: "company_overlap",
      description: `${group.length} contacts share ${displayName}`,
      contactIds: ids,
      contactCount: group.length,
      existingCircle: matchingCircle,
      suggestedCadence: 30,
      contacts: group.map((c) => ({
        id: c.id, name: c.name, company: c.company,
      })),
    });
    ids.forEach((id) => assignedIds.add(id));
  }

  // ── Signal 2c: Geographic clustering (M0.x.14) ──
  // Group remaining uncircled contacts by city. Uses Contact.city
  // (populated from Google Contacts sync). Only emits cities with ≥5
  // contacts since cities are more general than companies and need a
  // larger cluster to feel meaningful as a circle.
  const cityGroups = new Map<string, ContactWithMeta[]>();
  for (const c of uncircled) {
    if (assignedIds.has(c.id)) continue;
    const cityKey = normalizeCity(c.city);
    if (!cityKey) continue;
    const existing = cityGroups.get(cityKey) ?? [];
    existing.push(c);
    cityGroups.set(cityKey, existing);
  }

  const citySuggestions = Array.from(cityGroups.entries())
    .filter(([, group]) => group.length >= 5)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 5);

  for (const [cityKey, group] of citySuggestions) {
    const ids = group.map((c) => c.id);
    const displayName = group[0].city?.trim() ?? cityKey;
    const matchingCircle = findMatchingCircle(displayName, circles);
    suggestions.push({
      id: `signal:geo:${cityKey}`,
      name: matchingCircle?.name ?? displayName,
      reason: "geographic",
      description: `${group.length} contacts in ${displayName}`,
      contactIds: ids,
      contactCount: group.length,
      existingCircle: matchingCircle,
      suggestedCadence: 60,
      contacts: group.map((c) => ({
        id: c.id, name: c.name, company: c.company,
      })),
    });
    ids.forEach((id) => assignedIds.add(id));
  }

  // ── Signal 3: Friends (frequent interactions, no circle) ──
  const frequentUncircled = uncircled.filter(
    (c) => !assignedIds.has(c.id) && (frequencyMap.get(c.id) ?? 0) >= 5,
  );
  if (frequentUncircled.length >= 2) {
    const ids = frequentUncircled.map((c) => c.id);
    const matchingCircle = findMatchingCircle("Friends", circles)
      ?? findMatchingCircle("Inner Circle", circles)
      ?? findMatchingCircle("Close", circles);

    suggestions.push({
      id: "signal:friends",
      name: matchingCircle?.name ?? "Friends",
      reason: "frequent_interaction",
      description: `${frequentUncircled.length} people you interact with frequently`,
      contactIds: ids,
      contactCount: frequentUncircled.length,
      existingCircle: matchingCircle,
      suggestedCadence: 7,
      contacts: frequentUncircled.map((c) => ({
        id: c.id, name: c.name, company: c.company,
      })),
    });
  }

  return suggestions.sort((a, b) => {
    const priorityDelta = reasonPriority(b.reason) - reasonPriority(a.reason);
    if (priorityDelta !== 0) return priorityDelta;
    return b.contactCount - a.contactCount;
  });
}

// ─── Helpers ────────────────────────────────────────────────

async function buildCommunicationGroupSuggestions({
  userId,
  uncircledById,
  circles,
}: {
  userId: string;
  uncircledById: ReadonlyMap<string, ContactWithMeta>;
  circles: readonly ExistingCircle[];
}): Promise<CircleSuggestion[]> {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setDate(sixMonthsAgo.getDate() - 180);

  const rows = await prisma.interaction.findMany({
    where: {
      userId,
      occurredAt: { gte: sixMonthsAgo },
      OR: [
        { threadId: { not: null } },
        { chatId: { not: null }, isGroupChat: true },
      ],
    },
    orderBy: { occurredAt: "desc" },
    take: 1000,
    select: {
      contactId: true,
      subject: true,
      chatId: true,
      chatName: true,
      isGroupChat: true,
      threadId: true,
      occurredAt: true,
      thread: { select: { displayName: true, source: true, isGroup: true } },
    },
  });

  const groups = new Map<
    string,
    {
      displayName: string | null;
      source: string | null;
      subjects: string[];
      interactions: number;
      latestAt: Date;
      contacts: Map<string, ContactWithMeta>;
    }
  >();

  for (const row of rows) {
    const contact = uncircledById.get(row.contactId);
    if (!contact) continue;

    const key = row.threadId ?? (row.isGroupChat ? row.chatId : null);
    if (!key) continue;

    const existing = groups.get(key) ?? {
      displayName: row.thread?.displayName ?? row.chatName ?? null,
      source: row.thread?.source ?? null,
      subjects: [],
      interactions: 0,
      latestAt: row.occurredAt,
      contacts: new Map<string, ContactWithMeta>(),
    };
    existing.interactions += 1;
    if (row.occurredAt > existing.latestAt) existing.latestAt = row.occurredAt;
    if (row.subject) existing.subjects.push(row.subject);
    existing.contacts.set(contact.id, contact);
    groups.set(key, existing);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => {
      const contacts = Array.from(group.contacts.values());
      return { key, group, contacts };
    })
    .filter(({ contacts }) => contacts.length >= 2)
    .sort((a, b) => {
      const scoreA = a.contacts.length * 10 + a.group.interactions;
      const scoreB = b.contacts.length * 10 + b.group.interactions;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return b.group.latestAt.getTime() - a.group.latestAt.getTime();
    })
    .slice(0, 3)
    .map(({ key, group, contacts }) => {
      const ids = contacts.map((c) => c.id);
      const inferredName =
        inferCommunicationGroupName(group.displayName, group.subjects) ??
        "Recent conversation group";
      const matchingCircle = findMatchingCircle(inferredName, circles);
      return {
        id: `signal:communication:${key}`,
        name: matchingCircle?.name ?? inferredName,
        reason: "communication_group" as const,
        description: `${contacts.length} uncircled people appear in the same recent conversation`,
        contactIds: ids,
        contactCount: contacts.length,
        existingCircle: matchingCircle,
        suggestedCadence: 14,
        contacts: contacts.map((c) => ({
          id: c.id,
          name: c.name,
          company: c.company,
        })),
      };
    });
}

function inferCommunicationGroupName(
  displayName: string | null,
  subjects: readonly string[],
): string | null {
  const display = cleanGroupName(displayName);
  if (display) return display;

  const subject = subjects.map(cleanGroupName).find(Boolean);
  if (!subject) return null;
  return subject.length > 48 ? `${subject.slice(0, 45)}...` : subject;
}

function cleanGroupName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^(re|fwd?):\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 3) return null;
  return cleaned;
}

function reasonPriority(reason: SuggestionReason): number {
  if (reason === "communication_group") return 3;
  if (reason === "frequent_interaction") return 2;
  return 1;
}

function findMatchingCircle(
  name: string,
  circles: readonly ExistingCircle[],
): ExistingCircle | null {
  const norm = name.toLowerCase();
  return circles.find((c) => {
    const cn = c.name.toLowerCase();
    return cn.includes(norm) || norm.includes(cn);
  }) ?? null;
}

/**
 * Normalize a company string for grouping (M0.x.14). Lowercases, trims,
 * strips common suffixes ("Inc.", "LLC", "Ltd.") so "Anthropic" and
 * "Anthropic Inc." cluster together. Returns null for empty / one-char
 * inputs which are noise.
 */
export function normalizeCompany(company: string | null | undefined): string | null {
  if (!company) return null;
  let s = company.trim().toLowerCase();
  s = s.replace(/[,]?\s+(inc|llc|ltd|co|corp|corporation|company|gmbh|sa|nv|plc|holdings|group)\.?\s*$/i, "");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length < 2) return null;
  return s;
}

/**
 * Normalize a city string for grouping (M0.x.14). Lowercases, trims,
 * collapses whitespace. Returns null for empty inputs. Doesn't try to
 * be clever about "SF" vs "San Francisco" — Google Contacts is usually
 * consistent within an account, and false negatives are cheap to fix
 * after the user sees them.
 */
export function normalizeCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const s = city.trim().toLowerCase().replace(/\s+/g, " ");
  if (s.length < 2) return null;
  return s;
}
