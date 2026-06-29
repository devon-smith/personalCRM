/**
 * Per-contact memory synthesis worker (M8.1).
 *
 * Walks each user's contacts with ≥5 new interactions since the last
 * synthesis and asks Claude Sonnet to update their ContactMemory.
 * Throttled to 30 contacts per run.
 *
 * Daily cron at 03:00 UTC (after contact-attribute-extraction at 02:00
 * and graph-edge-extraction at 02:30 — runs last because memory
 * synthesis is the heaviest Claude call of the three).
 */
import type { Task } from "graphile-worker";
import { Prisma, type PrismaClient } from "../../src/generated/prisma/client";
import { createWorkerPrismaClient } from "../db.js";
import {
  synthesizeMemory,
  type PriorMemory,
} from "../../src/lib/intelligence/synthesize-memory";

const CONTACTS_PER_RUN = 30;
const MIN_INTERACTIONS = 5;
const INTERACTION_DELTA_THRESHOLD = 5;

interface SynthesisPayload {
  userId?: string;
  force?: boolean;
}

const memorySynthesis: Task = async (rawPayload, helpers) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    helpers.logger.debug("memory-synthesis: no ANTHROPIC_API_KEY, skipping");
    return;
  }

  const payload = (rawPayload ?? {}) as SynthesisPayload;
  const prisma = createWorkerPrismaClient();

  try {
    const userIds = payload.userId
      ? [payload.userId]
      : (await prisma.user.findMany({ select: { id: true } })).map((u) => u.id);

    for (const userId of userIds) {
      const summary = await synthesizeForUser(
        prisma,
        userId,
        payload.force ?? false,
      );
      helpers.logger.info(
        `memory-synthesis: user=${userId} ` +
          `processed=${summary.processed} synthesized=${summary.synthesized} ` +
          `failed=${summary.failed}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
};

interface RunSummary {
  processed: number;
  synthesized: number;
  failed: number;
}

async function synthesizeForUser(
  prisma: PrismaClient,
  userId: string,
  force: boolean,
): Promise<RunSummary> {
  const summary: RunSummary = { processed: 0, synthesized: 0, failed: 0 };

  // Eligible: contacts with enough interactions, where either no
  // memory exists yet OR the interaction delta exceeds the threshold.
  // Order by recency so the most actively-conversed people are first
  // in the per-run cap.
  const candidates = await prisma.contact.findMany({
    where: {
      userId,
      interactions: { some: {} },
    },
    select: {
      id: true,
      name: true,
      company: true,
      role: true,
      notes: true,
      _count: { select: { interactions: true } },
      memory: {
        select: {
          interactionsAtSynthesis: true,
          discussedTopics: true,
          theyMentioned: true,
          openThreads: true,
          personalContext: true,
          recurringThemes: true,
        },
      },
    },
    orderBy: { lastInteraction: "desc" },
    take: CONTACTS_PER_RUN * 3,
  });

  const eligible = candidates.filter((c) => {
    if (c._count.interactions < MIN_INTERACTIONS) return false;
    if (force) return true;
    if (!c.memory) return true;
    return (
      c._count.interactions - c.memory.interactionsAtSynthesis >=
      INTERACTION_DELTA_THRESHOLD
    );
  });

  for (const contact of eligible.slice(0, CONTACTS_PER_RUN)) {
    summary.processed++;
    const [interactions, journalEntries] = await Promise.all([
      prisma.interaction.findMany({
        where: { contactId: contact.id, userId },
        orderBy: { occurredAt: "desc" },
        take: 30,
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

    // Prior memory is just round-tripped to Claude as context — the
    // typed shape is enforced by the JSON the model returns, not by
    // what we read back from the DB.
    const priorMemory: PriorMemory | null = contact.memory
      ? ({
          discussedTopics: asArray(contact.memory.discussedTopics),
          theyMentioned: asArray(contact.memory.theyMentioned),
          openThreads: asArray(contact.memory.openThreads),
          personalContext: asObject(contact.memory.personalContext),
          recurringThemes: contact.memory.recurringThemes,
        } as unknown as PriorMemory)
      : null;

    const synthesized = await synthesizeMemory({
      contact: {
        name: contact.name,
        company: contact.company,
        role: contact.role,
        notes: contact.notes,
      },
      interactions,
      journalEntries,
      priorMemory,
    });

    if (!synthesized) {
      summary.failed++;
      continue;
    }

    const data = {
      discussedTopics: jsonValue(synthesized.discussedTopics),
      theyMentioned: jsonValue(synthesized.theyMentioned),
      openThreads: jsonValue(synthesized.openThreads),
      personalContext: jsonValue(synthesized.personalContext),
      recurringThemes: synthesized.recurringThemes,
      interactionsAtSynthesis: contact._count.interactions,
      synthesizedAt: new Date(),
    };

    await prisma.contactMemory.upsert({
      where: { contactId: contact.id },
      create: { contactId: contact.id, ...data },
      update: data,
    });
    summary.synthesized++;
  }

  return summary;
}

// Helpers — defensive parsing on Json columns that come back as
// `unknown` from Prisma.
type SomeArray = ReadonlyArray<Record<string, unknown>>;
function asArray<T extends Record<string, unknown>>(v: unknown): SomeArray {
  return Array.isArray(v) ? (v as ReadonlyArray<T>) : [];
}
function asObject(v: unknown): Record<string, string | undefined> {
  return v && typeof v === "object" ? (v as Record<string, string>) : {};
}

function jsonValue(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;
}

export default memorySynthesis;
