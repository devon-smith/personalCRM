/**
 * Contact attribute extraction worker (M7.1).
 *
 * Walks each user's contacts (≥5 interactions; never extracted OR
 * accumulated ≥10 new interactions since the last snapshot) and
 * produces a structured ContactProfile via Claude Sonnet. Throttled
 * to 50 contacts per run so cost stays predictable.
 *
 * Daily cron at 02:00 UTC. Idempotent — if every contact's profile is
 * fresh, the task no-ops in <100ms.
 */
import type { Task } from "graphile-worker";
import { Prisma, type PrismaClient } from "../../src/generated/prisma/client";
import { createWorkerPrismaClient } from "../db.js";
import { extractAttributes } from "../../src/lib/intelligence/extract-attributes";

const CONTACTS_PER_RUN = 50;
const MIN_INTERACTIONS = 5;
const INTERACTION_DELTA_THRESHOLD = 10;

interface ExtractPayload {
  userId?: string;
  /** Force re-extraction even when below the delta threshold. */
  force?: boolean;
}

const contactAttributeExtraction: Task = async (rawPayload, helpers) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    helpers.logger.debug(
      "contact-attribute-extraction: no ANTHROPIC_API_KEY, skipping",
    );
    return;
  }

  const payload = (rawPayload ?? {}) as ExtractPayload;
  const prisma = createWorkerPrismaClient();

  try {
    const userIds = payload.userId
      ? [payload.userId]
      : (await prisma.user.findMany({ select: { id: true } })).map((u) => u.id);

    for (const userId of userIds) {
      const summary = await extractForUser(
        prisma,
        userId,
        payload.force ?? false,
      );
      helpers.logger.info(
        `contact-attribute-extraction: user=${userId} ` +
          `processed=${summary.processed} extracted=${summary.extracted} ` +
          `skipped=${summary.skipped} failed=${summary.failed}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
};

interface RunSummary {
  processed: number;
  extracted: number;
  skipped: number;
  failed: number;
}

async function extractForUser(
  prisma: PrismaClient,
  userId: string,
  force: boolean,
): Promise<RunSummary> {
  const summary: RunSummary = {
    processed: 0,
    extracted: 0,
    skipped: 0,
    failed: 0,
  };

  // Candidate contacts: those with enough interactions to extract from.
  // We use Interaction row count rather than email count — voice corpus
  // is sent-only; here we want any signal (inbound, calendar, etc.).
  const candidates = await prisma.contact.findMany({
    where: {
      userId,
      interactions: { some: {} },
    },
    select: {
      id: true,
      name: true,
      email: true,
      company: true,
      role: true,
      city: true,
      state: true,
      country: true,
      notes: true,
      howWeMet: true,
      lastSeenScholarlyInstitution: true,
      _count: { select: { interactions: true } },
      profile: {
        select: { interactionsAtGeneration: true },
      },
      circles: { select: { circle: { select: { name: true } } } },
    },
    orderBy: { lastInteraction: "desc" },
    take: CONTACTS_PER_RUN * 3, // headroom — we'll filter below
  });

  const eligible = candidates.filter((c) => {
    if (c._count.interactions < MIN_INTERACTIONS) return false;
    if (force) return true;
    if (!c.profile) return true;
    const delta =
      c._count.interactions - c.profile.interactionsAtGeneration;
    return delta >= INTERACTION_DELTA_THRESHOLD;
  });

  for (const contact of eligible.slice(0, CONTACTS_PER_RUN)) {
    summary.processed++;

    const [interactions, journalEntries] = await Promise.all([
      prisma.interaction.findMany({
        where: { contactId: contact.id, userId },
        orderBy: { occurredAt: "desc" },
        take: 50,
        select: {
          type: true,
          direction: true,
          subject: true,
          summary: true,
          occurredAt: true,
        },
      }),
      prisma.journalEntry.findMany({
        where: { contactId: contact.id, userId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { content: true, mood: true, createdAt: true },
      }),
    ]);

    const attributes = await extractAttributes({
      contact: {
        name: contact.name,
        email: contact.email,
        company: contact.company,
        role: contact.role,
        city: contact.city,
        state: contact.state,
        country: contact.country,
        notes: contact.notes,
        howWeMet: contact.howWeMet,
        lastSeenScholarlyInstitution: contact.lastSeenScholarlyInstitution,
        circles: contact.circles.map((c) => c.circle.name),
      },
      interactions,
      journalEntries: journalEntries.map((j) => ({
        content: j.content,
        mood: j.mood,
        createdAt: j.createdAt,
      })),
    });

    if (!attributes) {
      summary.failed++;
      continue;
    }

    // rawAttributes is non-nullable in the schema (defaults to {}).
    // The structured blocks are nullable — Prisma.JsonNull tells Prisma
    // to write SQL NULL rather than the JSON value `null`.
    const base = {
      expertiseAreas: attributes.expertiseAreas,
      communicationStyle: jsonValue(attributes.communicationStyle),
      geographicContext: jsonValue(attributes.geographicContext),
      personalitySignals: jsonValue(attributes.personalitySignals),
      relationshipStage: attributes.relationshipStage,
      rawAttributes: JSON.parse(
        JSON.stringify(attributes.rawAttributes ?? {}),
      ) as Prisma.InputJsonValue,
      interactionsAtGeneration: contact._count.interactions,
      generatedAt: new Date(),
    };

    await prisma.contactProfile.upsert({
      where: { contactId: contact.id },
      create: { contactId: contact.id, ...base },
      update: base,
    });
    summary.extracted++;
  }

  summary.skipped = candidates.length - summary.processed;
  return summary;
}

function jsonValue(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (v === null || v === undefined) return Prisma.JsonNull;
  // Round-trip strips non-JSON values (functions, undefined nested) and
  // coerces to Prisma's InputJsonValue shape.
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

export default contactAttributeExtraction;
