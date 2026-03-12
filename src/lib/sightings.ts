/**
 * Contact Sighting Helper
 *
 * Single entry point for all import sources. Creates a ContactSighting record,
 * runs identity resolution, and auto-merges/creates contacts as appropriate.
 */

import { prisma } from "@/lib/prisma";
import type { ContactSource, SightingResolution } from "@/generated/prisma/client";
import {
  buildContactIndex,
  resolveSighting,
  type CandidateContact,
  type ContactIndex,
  type SightingData,
} from "./identity-resolution";

// ─── Types ───────────────────────────────────────────────────

export interface SightingInput {
  source: ContactSource;
  externalId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  linkedinUrl: string | null;
  avatarUrl?: string | null;
  tags?: string[];
  notes?: string | null;
  rawData?: Record<string, unknown>;
}

export interface BatchResult {
  created: number;
  merged: number;
  reviewNeeded: number;
  skipped: number;
  total: number;
}

export interface BatchContext {
  userId: string;
  contacts: CandidateContact[];
  index: ContactIndex;
  matchedIds: Set<string>;
  createdNames: Set<string>;
}

// ─── Batch context ───────────────────────────────────────────

/**
 * Initialize a batch context for processing multiple sightings.
 * Loads all existing contacts once and builds the index.
 */
export async function createBatchContext(userId: string): Promise<BatchContext> {
  const contacts = await prisma.contact.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      company: true,
      role: true,
      city: true,
      state: true,
      country: true,
      linkedinUrl: true,
      avatarUrl: true,
    },
  });

  return {
    userId,
    contacts,
    index: buildContactIndex(contacts),
    matchedIds: new Set(),
    createdNames: new Set(),
  };
}

// ─── Process a single sighting ───────────────────────────────

/**
 * Process a single sighting: create the sighting record, run resolution,
 * and take action (enrich existing contact, create new, or queue for review).
 */
export async function processOneSighting(
  ctx: BatchContext,
  input: SightingInput,
): Promise<SightingResolution> {
  // Skip sightings without any identifying info
  if (!input.name && !input.email && !input.phone) {
    return "PENDING";
  }

  // Check idempotency: skip if this exact sighting already exists
  if (input.externalId) {
    const existing = await prisma.contactSighting.findUnique({
      where: {
        userId_source_externalId: {
          userId: ctx.userId,
          source: input.source,
          externalId: input.externalId,
        },
      },
    });
    if (existing) return existing.resolution;
  }

  // Run identity resolution
  const sightingData: SightingData = {
    name: input.name,
    email: input.email,
    phone: input.phone,
    company: input.company,
    role: input.role,
    city: input.city,
    state: input.state,
    country: input.country,
    linkedinUrl: input.linkedinUrl,
    avatarUrl: input.avatarUrl ?? null,
  };

  const result = resolveSighting(sightingData, ctx.index, ctx.matchedIds);

  let contactId = result.contactId;
  let resolution: SightingResolution = result.outcome;

  // ── AUTO_MERGED: enrich existing contact ──
  if (resolution === "AUTO_MERGED" && contactId) {
    ctx.matchedIds.add(contactId);

    if (Object.keys(result.enrichment).length > 0) {
      await prisma.contact.update({
        where: { id: contactId },
        data: result.enrichment,
      });

      // Update the in-memory contact and rebuild index entries
      const contact = ctx.contacts.find((c) => c.id === contactId);
      if (contact) {
        Object.assign(contact, result.enrichment);
      }
    }
  }

  // ── NEW_CONTACT: create contact ──
  if (resolution === "NEW_CONTACT" && input.name) {
    // In-batch dedup by normalized name
    const normName = (input.name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    if (ctx.createdNames.has(normName)) {
      resolution = "AUTO_MERGED";
    } else {
      ctx.createdNames.add(normName);

      const newContact = await prisma.contact.create({
        data: {
          userId: ctx.userId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          company: input.company,
          role: input.role,
          tier: "ACQUAINTANCE",
          source: input.source,
          linkedinUrl: input.linkedinUrl,
          city: input.city,
          state: input.state,
          country: input.country,
          avatarUrl: input.avatarUrl,
          notes: input.notes,
          tags: input.tags ?? [],
          importedAt: new Date(),
        },
      });

      contactId = newContact.id;

      // Add to in-memory index for subsequent sightings in the same batch
      const candidate: CandidateContact = {
        id: newContact.id,
        name: input.name,
        email: input.email,
        phone: input.phone,
        company: input.company,
        role: input.role,
        city: input.city,
        state: input.state,
        country: input.country,
        linkedinUrl: input.linkedinUrl,
        avatarUrl: input.avatarUrl ?? null,
      };
      ctx.contacts.push(candidate);
      // Rebuild index (fast for single-user CRM)
      ctx.index = buildContactIndex(ctx.contacts);
    }
  }

  // ── REVIEW_NEEDED: store candidate for later ──
  // contactId is already set to the candidate

  // ── Create the sighting record ──
  await prisma.contactSighting.create({
    data: {
      userId: ctx.userId,
      source: input.source,
      externalId: input.externalId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      company: input.company,
      role: input.role,
      city: input.city,
      state: input.state,
      country: input.country,
      linkedinUrl: input.linkedinUrl,
      avatarUrl: input.avatarUrl,
      rawData: input.rawData ? JSON.parse(JSON.stringify(input.rawData)) : undefined,
      contactId,
      resolution,
      confidence: result.confidence,
      resolvedAt: resolution !== "REVIEW_NEEDED" ? new Date() : undefined,
    },
  });

  return resolution;
}

// ─── Process a batch of sightings ────────────────────────────

/**
 * Process a batch of sightings from a single source.
 * Returns aggregate counts.
 */
export async function processBatch(
  userId: string,
  sightings: SightingInput[],
): Promise<BatchResult> {
  const ctx = await createBatchContext(userId);

  let created = 0;
  let merged = 0;
  let reviewNeeded = 0;
  let skipped = 0;

  for (const input of sightings) {
    const resolution = await processOneSighting(ctx, input);

    switch (resolution) {
      case "NEW_CONTACT":
        created++;
        break;
      case "AUTO_MERGED":
        merged++;
        break;
      case "REVIEW_NEEDED":
        reviewNeeded++;
        break;
      default:
        skipped++;
    }
  }

  return { created, merged, reviewNeeded, skipped, total: sightings.length };
}
