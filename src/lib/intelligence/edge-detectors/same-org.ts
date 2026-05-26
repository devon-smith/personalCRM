/**
 * Same-org edge detector (M7.2).
 *
 * Two contacts share a `same_org` edge when either:
 *   1. Their Contact.company strings match (after light normalization)
 *   2. Their email addresses share a non-personal domain
 *
 * Email domain is often the stronger signal — typos and abbreviations
 * fragment the company field, while corporate emails are stable.
 * Personal-domain emails (gmail, outlook, etc.) are explicitly
 * excluded to avoid linking everyone who happens to have a Gmail
 * account.
 *
 * Strength: 0.7 when both signals agree, 0.5 for company-only or
 * domain-only.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import type { EdgeProposal } from ".";
import { pairKey, unpairKey } from "./mutual-thread";

const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "fastmail.com",
  "duck.com",
  "pm.me",
]);

export interface DetectSameOrgParams {
  prisma: PrismaClient;
  userId: string;
}

export async function detectSameOrgEdges(
  params: DetectSameOrgParams,
): Promise<EdgeProposal[]> {
  resetEmissionCounter();
  const { prisma, userId } = params;
  const contacts = await prisma.contact.findMany({
    where: { userId },
    select: { id: true, company: true, email: true },
  });

  // Bucket contacts by normalized company AND by email domain.
  const byCompany = new Map<string, string[]>();
  const byDomain = new Map<string, string[]>();

  for (const c of contacts) {
    const company = normalizeCompany(c.company);
    if (company) {
      if (!byCompany.has(company)) byCompany.set(company, []);
      byCompany.get(company)!.push(c.id);
    }
    const domain = extractDomain(c.email);
    if (domain && !PERSONAL_DOMAINS.has(domain)) {
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain)!.push(c.id);
    }
  }

  // For each bucket with ≥2 contacts, emit pairwise proposals.
  // Track whether the pair was supported by company, domain, or both
  // so we can score accordingly.
  interface Support {
    company: string | null;
    domain: string | null;
  }
  const pairSupport = new Map<string, Support>();

  for (const [company, ids] of byCompany) {
    emitPairs(ids, (key) => {
      const prev = pairSupport.get(key);
      if (prev) prev.company = company;
      else pairSupport.set(key, { company, domain: null });
    });
  }
  for (const [domain, ids] of byDomain) {
    emitPairs(ids, (key) => {
      const prev = pairSupport.get(key);
      if (prev) prev.domain = domain;
      else pairSupport.set(key, { company: null, domain });
    });
  }

  const proposals: EdgeProposal[] = [];
  for (const [key, support] of pairSupport) {
    const [contactA, contactB] = unpairKey(key);
    const both = support.company && support.domain;
    proposals.push({
      contactA,
      contactB,
      edgeType: "same_org",
      strength: both ? 0.7 : 0.5,
      evidence: {
        signal: both ? "company+domain" : support.company ? "company" : "email_domain",
        company: support.company,
        domain: support.domain,
      },
    });
  }
  return proposals;
}

// Per-bucket cap. A typo'd company or a personal-domain provider
// that slipped through the filter could otherwise collapse hundreds
// of contacts together and emit ~20K pairs from a single bucket.
const MAX_BUCKET_SIZE = 50;
// Hard global ceiling per detector call. Pathological data shapes
// (e.g., every contact at "Stanford University" via fuzzy match)
// shouldn't blow up the daily worker into a million-row transaction.
const MAX_TOTAL_PAIRS = 20_000;

let emittedSoFar = 0;

function emitPairs(ids: string[], emit: (key: string) => void) {
  if (ids.length < 2) return;
  const capped = ids.slice(0, MAX_BUCKET_SIZE);
  for (let i = 0; i < capped.length; i++) {
    for (let j = i + 1; j < capped.length; j++) {
      if (emittedSoFar >= MAX_TOTAL_PAIRS) return;
      if (capped[i] === capped[j]) continue;
      emit(pairKey(capped[i], capped[j]));
      emittedSoFar++;
    }
  }
}

/** Reset the global emission counter between detector invocations.
 *  detectSameOrgEdges calls this at entry. */
function resetEmissionCounter() {
  emittedSoFar = 0;
}

// ─── Pure helpers (exported for testing) ───────────────────

export function normalizeCompany(company: string | null): string | null {
  if (!company) return null;
  const trimmed = company
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|llc|corp|corporation|ltd|gmbh|sa)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return trimmed.length >= 2 ? trimmed : null;
}

export function extractDomain(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase().trim() || null;
}

export function isPersonalDomain(domain: string): boolean {
  return PERSONAL_DOMAINS.has(domain.toLowerCase());
}
