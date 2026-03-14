/**
 * Identity Resolution Engine
 *
 * Pure function that scores how likely a sighting matches an existing contact.
 * Returns the best match with a confidence score, or null for no match.
 *
 * Matching tiers:
 *   1. Email exact match  → 0.95 confidence (auto-merge)
 *   2. Phone exact match  → 0.90 confidence (auto-merge)
 *   3. Name + Company     → 0.50-0.80 confidence (review queue)
 *   3b. Nickname + Last name → 0.55-0.75 confidence (review queue)
 *   4. No match           → create new contact
 */

import {
  normalizeEmail,
  normalizeName,
  nameMatchKeys,
  normalizePhone,
  normalizeLinkedInUrl,
  normalizeCompany,
  companiesMatch,
  parseFirstLast,
} from "./name-utils";
import { namesAreRelated } from "./nicknames";

// ─── Types ───────────────────────────────────────────────────

export interface SightingData {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  linkedinUrl: string | null;
  avatarUrl: string | null;
}

export interface CandidateContact {
  id: string;
  name: string;
  email: string | null;
  additionalEmails?: string[];
  phone: string | null;
  additionalPhones?: string[];
  company: string | null;
  role: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  linkedinUrl: string | null;
  avatarUrl: string | null;
  aliases?: string[];
}

export type ResolutionOutcome = "AUTO_MERGED" | "REVIEW_NEEDED" | "NEW_CONTACT";

export interface ResolutionResult {
  outcome: ResolutionOutcome;
  contactId: string | null;
  confidence: number;
  enrichment: Record<string, string | null>;
  matchReason: string | null;
}

// ─── Enrichment ──────────────────────────────────────────────

/**
 * Build enrichment data — only fills fields that are currently null on the contact.
 */
function buildEnrichment(
  existing: CandidateContact,
  sighting: SightingData,
): Record<string, string | null> {
  const updates: Record<string, string | null> = {};

  if (!existing.phone && sighting.phone) updates.phone = sighting.phone;
  if (!existing.company && sighting.company) updates.company = sighting.company;
  if (!existing.role && sighting.role) updates.role = sighting.role;
  if (!existing.city && sighting.city) updates.city = sighting.city;
  if (!existing.state && sighting.state) updates.state = sighting.state;
  if (!existing.country && sighting.country) updates.country = sighting.country;
  if (!existing.linkedinUrl && sighting.linkedinUrl) updates.linkedinUrl = sighting.linkedinUrl;
  if (!existing.avatarUrl && sighting.avatarUrl) updates.avatarUrl = sighting.avatarUrl;
  if (!existing.email && sighting.email) updates.email = sighting.email;

  return updates;
}

// ─── Index builders ──────────────────────────────────────────

export interface ContactIndex {
  byEmail: Map<string, CandidateContact>;
  byPhone: Map<string, CandidateContact>;
  byNameKeys: Map<string, CandidateContact[]>;
  byLinkedInUrl: Map<string, CandidateContact>;
  byLastNameCompany: Map<string, CandidateContact[]>;
}

/**
 * Build lookup indexes from an array of contacts.
 * Call once per batch import, pass to resolveSighting for each item.
 */
export function buildContactIndex(contacts: CandidateContact[]): ContactIndex {
  const byEmail = new Map<string, CandidateContact>();
  const byPhone = new Map<string, CandidateContact>();
  const byNameKeys = new Map<string, CandidateContact[]>();
  const byLinkedInUrl = new Map<string, CandidateContact>();
  const byLastNameCompany = new Map<string, CandidateContact[]>();

  for (const c of contacts) {
    // Primary email
    if (c.email) {
      byEmail.set(normalizeEmail(c.email), c);
    }
    // Additional emails
    for (const ae of c.additionalEmails ?? []) {
      byEmail.set(normalizeEmail(ae), c);
    }
    // Primary phone
    if (c.phone) {
      byPhone.set(normalizePhone(c.phone), c);
    }
    // Additional phones
    for (const ap of c.additionalPhones ?? []) {
      byPhone.set(normalizePhone(ap), c);
    }
    if (c.linkedinUrl) {
      byLinkedInUrl.set(normalizeLinkedInUrl(c.linkedinUrl), c);
    }
    // Primary name
    for (const key of nameMatchKeys(c.name)) {
      const existing = byNameKeys.get(key) ?? [];
      existing.push(c);
      byNameKeys.set(key, existing);
    }
    // Aliases — index each alias as a name match key
    for (const alias of c.aliases ?? []) {
      // Build a synthetic full name: "alias lastName" for name key indexing
      const { last } = parseFirstLast(c.name);
      const aliasFullName = last ? `${alias} ${last}` : alias;
      for (const key of nameMatchKeys(aliasFullName)) {
        const existing = byNameKeys.get(key) ?? [];
        if (!existing.some((e) => e.id === c.id)) {
          existing.push(c);
        }
        byNameKeys.set(key, existing);
      }
    }
    // Index by lastName + normalized company for LinkedIn matching
    if (c.company) {
      const { last } = parseFirstLast(c.name);
      if (last) {
        const key = `${normalizeName(last)}:${normalizeCompany(c.company)}`;
        const existing = byLastNameCompany.get(key) ?? [];
        existing.push(c);
        byLastNameCompany.set(key, existing);
      }
    }
  }

  return { byEmail, byPhone, byNameKeys, byLinkedInUrl, byLastNameCompany };
}

// ─── Core Resolution ─────────────────────────────────────────

/**
 * Resolve a single sighting against the contact index.
 *
 * @param sighting - The raw sighting data
 * @param index - Pre-built contact index
 * @param matchedIds - Set of contact IDs already matched in this batch (prevents double-matching)
 * @returns Resolution result with outcome, confidence, and enrichment data
 */
export function resolveSighting(
  sighting: SightingData,
  index: ContactIndex,
  matchedIds: Set<string> = new Set(),
): ResolutionResult {
  // ── Tier 1: Email match (confidence 0.95) ──
  if (sighting.email) {
    const emailKey = normalizeEmail(sighting.email);
    const emailMatch = index.byEmail.get(emailKey);

    if (emailMatch && !matchedIds.has(emailMatch.id)) {
      return {
        outcome: "AUTO_MERGED",
        contactId: emailMatch.id,
        confidence: 0.95,
        enrichment: buildEnrichment(emailMatch, sighting),
        matchReason: "email",
      };
    }
  }

  // ── Tier 2: Phone match (confidence 0.90) ──
  if (sighting.phone) {
    const phoneKey = normalizePhone(sighting.phone);
    const phoneMatch = index.byPhone.get(phoneKey);

    if (phoneMatch && !matchedIds.has(phoneMatch.id)) {
      return {
        outcome: "AUTO_MERGED",
        contactId: phoneMatch.id,
        confidence: 0.90,
        enrichment: buildEnrichment(phoneMatch, sighting),
        matchReason: "phone",
      };
    }

    // Try suffix match for phone (without country code)
    if (phoneKey.startsWith("+1") && phoneKey.length > 5) {
      const suffix = phoneKey.slice(2);
      for (const [stored, contact] of index.byPhone) {
        if (stored.endsWith(suffix) && !matchedIds.has(contact.id)) {
          return {
            outcome: "AUTO_MERGED",
            contactId: contact.id,
            confidence: 0.85,
            enrichment: buildEnrichment(contact, sighting),
            matchReason: "phone_suffix",
          };
        }
      }
    }
  }

  // ── Tier 3: Name + Company match (confidence 0.50-0.80) ──
  if (sighting.name) {
    const sightingKeys = nameMatchKeys(sighting.name);
    const sightingCompany = sighting.company?.toLowerCase().trim();

    for (const key of sightingKeys) {
      const candidates = index.byNameKeys.get(key);
      if (!candidates) continue;

      for (const candidate of candidates) {
        if (matchedIds.has(candidate.id)) continue;

        const candidateCompany = candidate.company?.toLowerCase().trim();

        // Name + same company → 0.80
        if (sightingCompany && candidateCompany && sightingCompany === candidateCompany) {
          return {
            outcome: "REVIEW_NEEDED",
            contactId: candidate.id,
            confidence: 0.80,
            enrichment: buildEnrichment(candidate, sighting),
            matchReason: "name_and_company",
          };
        }

        // Name match, one or both sides have no company → 0.50
        if (!sightingCompany || !candidateCompany) {
          return {
            outcome: "REVIEW_NEEDED",
            contactId: candidate.id,
            confidence: 0.50,
            enrichment: buildEnrichment(candidate, sighting),
            matchReason: "name_only",
          };
        }
      }
    }
  }

  // ── Tier 3b: Nickname + last name match (confidence 0.55-0.75) ──
  if (sighting.name) {
    const sightingParsed = parseFirstLast(sighting.name);
    const sightingFirst = sightingParsed.first.toLowerCase();
    const sightingLast = normalizeName(sightingParsed.last);

    if (sightingFirst && sightingLast) {
      // Search all contacts by last name via the name keys index
      for (const [, candidates] of index.byNameKeys) {
        for (const candidate of candidates) {
          if (matchedIds.has(candidate.id)) continue;

          const candidateParsed = parseFirstLast(candidate.name);
          const candidateFirst = candidateParsed.first.toLowerCase();
          const candidateLast = normalizeName(candidateParsed.last);

          // Must share last name, different first name, and be nickname-related
          if (
            candidateLast === sightingLast &&
            candidateFirst !== sightingFirst &&
            namesAreRelated(sightingFirst, candidateFirst)
          ) {
            const sightingCompany = sighting.company?.toLowerCase().trim();
            const candidateCompany = candidate.company?.toLowerCase().trim();
            const sameCompany =
              sightingCompany &&
              candidateCompany &&
              sightingCompany === candidateCompany;

            return {
              outcome: "REVIEW_NEEDED" as const,
              contactId: candidate.id,
              confidence: sameCompany ? 0.75 : 0.55,
              enrichment: buildEnrichment(candidate, sighting),
              matchReason: sameCompany
                ? "nickname_and_company"
                : "nickname_last_name",
            };
          }
        }
      }
    }
  }

  // ── Tier 4: No match → New contact ──
  return {
    outcome: "NEW_CONTACT",
    contactId: null,
    confidence: 0,
    enrichment: {},
    matchReason: null,
  };
}

// ─── LinkedIn-specific Resolution ───────────────────────────

export interface LinkedInResolutionResult extends ResolutionResult {
  reviewReason: string | null;
  companyChanged: boolean;
  existingCompany: string | null;
}

/**
 * LinkedIn-specific identity resolution with adjusted matching cascade.
 * LinkedIn data often lacks email/phone, so name+company matching is elevated.
 *
 * Cascade:
 *   a) LinkedIn URL match → 0.99 (auto-merge)
 *   b) Email exact match → 0.99 (auto-merge)
 *   c) First+Last name + same company → 0.92 (auto-merge)
 *   d) First+Last name + different company → 0.75 (review: job change?)
 *   e) First name + last initial + same company → 0.70 (review)
 *   f) Last name + company match → 0.60 (review, low priority)
 *   g) No match → create new contact
 */
export function resolveLinkedInSighting(
  sighting: SightingData,
  index: ContactIndex,
  matchedIds: Set<string> = new Set(),
): LinkedInResolutionResult {
  const noResult: LinkedInResolutionResult = {
    outcome: "NEW_CONTACT",
    contactId: null,
    confidence: 0,
    enrichment: {},
    matchReason: null,
    reviewReason: null,
    companyChanged: false,
    existingCompany: null,
  };

  // Always set linkedinUrl in enrichment
  function buildLinkedInEnrichment(
    existing: CandidateContact,
    s: SightingData,
  ): Record<string, string | null> {
    const base = buildEnrichment(existing, s);
    // Always set linkedinUrl if not already set
    if (!existing.linkedinUrl && s.linkedinUrl) {
      base.linkedinUrl = s.linkedinUrl;
    }
    return base;
  }

  // ── a) LinkedIn URL match (confidence 0.99) ──
  if (sighting.linkedinUrl) {
    const urlKey = normalizeLinkedInUrl(sighting.linkedinUrl);
    const urlMatch = index.byLinkedInUrl.get(urlKey);

    if (urlMatch && !matchedIds.has(urlMatch.id)) {
      return {
        outcome: "AUTO_MERGED",
        contactId: urlMatch.id,
        confidence: 0.99,
        enrichment: buildLinkedInEnrichment(urlMatch, sighting),
        matchReason: "linkedin_url",
        reviewReason: null,
        companyChanged: !!(sighting.company && urlMatch.company &&
          !companiesMatch(sighting.company, urlMatch.company)),
        existingCompany: urlMatch.company,
      };
    }
  }

  // ── b) Email exact match (confidence 0.99) ──
  if (sighting.email) {
    const emailKey = normalizeEmail(sighting.email);
    const emailMatch = index.byEmail.get(emailKey);

    if (emailMatch && !matchedIds.has(emailMatch.id)) {
      return {
        outcome: "AUTO_MERGED",
        contactId: emailMatch.id,
        confidence: 0.99,
        enrichment: buildLinkedInEnrichment(emailMatch, sighting),
        matchReason: "email",
        reviewReason: null,
        companyChanged: !!(sighting.company && emailMatch.company &&
          !companiesMatch(sighting.company, emailMatch.company)),
        existingCompany: emailMatch.company,
      };
    }
  }

  // Parse the sighting name for detailed matching
  if (!sighting.name) return noResult;

  const sightingParsed = parseFirstLast(sighting.name);
  const sightingFirst = normalizeName(sightingParsed.first);
  const sightingLast = normalizeName(sightingParsed.last);

  if (!sightingFirst || !sightingLast) return noResult;

  // Search all name-matched candidates
  const sightingKeys = nameMatchKeys(sighting.name);

  for (const key of sightingKeys) {
    const candidates = index.byNameKeys.get(key);
    if (!candidates) continue;

    for (const candidate of candidates) {
      if (matchedIds.has(candidate.id)) continue;

      const candidateParsed = parseFirstLast(candidate.name);
      const candidateFirst = normalizeName(candidateParsed.first);
      const candidateLast = normalizeName(candidateParsed.last);

      // Full name match
      if (sightingFirst === candidateFirst && sightingLast === candidateLast) {
        // ── c) Same name + same company → 0.92 (auto-merge) ──
        if (sighting.company && candidate.company &&
            companiesMatch(sighting.company, candidate.company)) {
          return {
            outcome: "AUTO_MERGED",
            contactId: candidate.id,
            confidence: 0.92,
            enrichment: buildLinkedInEnrichment(candidate, sighting),
            matchReason: "name_and_company",
            reviewReason: null,
            companyChanged: false,
            existingCompany: candidate.company,
          };
        }

        // ── d) Same name + different company → 0.75 (review: job change?) ──
        if (sighting.company && candidate.company) {
          return {
            outcome: "REVIEW_NEEDED",
            contactId: candidate.id,
            confidence: 0.75,
            enrichment: buildLinkedInEnrichment(candidate, sighting),
            matchReason: "name_different_company",
            reviewReason: `Same name, different company: ${sighting.name} at ${sighting.company} vs ${candidate.name} at ${candidate.company}. Same person who changed jobs?`,
            companyChanged: true,
            existingCompany: candidate.company,
          };
        }

        // Same name, one or both missing company → 0.75 (review)
        return {
          outcome: "REVIEW_NEEDED",
          contactId: candidate.id,
          confidence: 0.75,
          enrichment: buildLinkedInEnrichment(candidate, sighting),
          matchReason: "name_only",
          reviewReason: `Same name: ${sighting.name}. Different sources may be the same person.`,
          companyChanged: false,
          existingCompany: candidate.company,
        };
      }

      // ── e) First name + last initial + same company → 0.70 (review) ──
      if (sightingFirst === candidateFirst &&
          candidateLast && sightingLast &&
          candidateLast[0] === sightingLast[0] &&
          sighting.company && candidate.company &&
          companiesMatch(sighting.company, candidate.company)) {
        return {
          outcome: "REVIEW_NEEDED",
          contactId: candidate.id,
          confidence: 0.70,
          enrichment: buildLinkedInEnrichment(candidate, sighting),
          matchReason: "first_name_last_initial_company",
          reviewReason: `Possible match: ${sighting.name} (LinkedIn) may be ${candidate.name}`,
          companyChanged: false,
          existingCompany: candidate.company,
        };
      }
    }
  }

  // ── f) Last name + company match → 0.60 (review, low priority) ──
  if (sighting.company && sightingLast) {
    const companyNorm = normalizeCompany(sighting.company);
    const key = `${sightingLast}:${companyNorm}`;
    const lastNameCompanyCandidates = index.byLastNameCompany.get(key);

    if (lastNameCompanyCandidates) {
      for (const candidate of lastNameCompanyCandidates) {
        if (matchedIds.has(candidate.id)) continue;
        // Only if first names are different (otherwise would have been caught above)
        const candidateParsed = parseFirstLast(candidate.name);
        if (normalizeName(candidateParsed.first) !== sightingFirst) {
          return {
            outcome: "REVIEW_NEEDED",
            contactId: candidate.id,
            confidence: 0.60,
            enrichment: buildLinkedInEnrichment(candidate, sighting),
            matchReason: "last_name_company",
            reviewReason: `Same last name and company: ${sighting.name} vs ${candidate.name} at ${candidate.company}. Could be a nickname or middle name.`,
            companyChanged: false,
            existingCompany: candidate.company,
          };
        }
      }
    }
  }

  // ── g) No match → create new contact ──
  return noResult;
}
