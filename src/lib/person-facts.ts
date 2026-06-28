import type { PrismaClient } from "@/generated/prisma/client";

export interface RecordPersonFactInput {
  readonly userId: string;
  readonly contactId: string;
  readonly type: string;
  readonly value: string;
  readonly confidence?: number;
  readonly sourceSystem: string;
  readonly sourceRecordId: string;
  readonly excerpt?: string | null;
  readonly observedAt: Date;
}

export interface PromptPersonFact {
  readonly id: string;
  readonly type: string;
  readonly value: string;
  readonly confidence: number;
  readonly sourceSystem: string;
  readonly sourceRecordId: string;
  readonly excerpt: string | null;
  readonly confirmedByUser: boolean;
  readonly observedAt: Date;
}

export async function recordPersonFact(
  prisma: PrismaClient,
  input: RecordPersonFactInput,
): Promise<void> {
  const value = input.value.trim();
  if (!value) return;

  await prisma.personFact.upsert({
    where: {
      userId_contactId_type_value_sourceSystem_sourceRecordId: {
        userId: input.userId,
        contactId: input.contactId,
        type: input.type,
        value,
        sourceSystem: input.sourceSystem,
        sourceRecordId: input.sourceRecordId,
      },
    },
    create: {
      userId: input.userId,
      contactId: input.contactId,
      type: input.type,
      value,
      confidence: input.confidence ?? 0.6,
      sourceSystem: input.sourceSystem,
      sourceRecordId: input.sourceRecordId,
      excerpt: input.excerpt ?? null,
      observedAt: input.observedAt,
    },
    update: {
      confidence: input.confidence ?? 0.6,
      excerpt: input.excerpt ?? null,
      observedAt: input.observedAt,
      dismissedAt: null,
    },
  });
}

export async function recordGmailAddressFact(
  prisma: PrismaClient,
  args: {
    readonly userId: string;
    readonly contactId: string;
    readonly email: string;
    readonly emailMessageId: string;
    readonly subject?: string | null;
    readonly snippet?: string | null;
    readonly observedAt: Date;
  },
): Promise<void> {
  const normalizedEmail = args.email.trim().toLowerCase();
  if (!normalizedEmail) return;

  await recordPersonFact(prisma, {
    userId: args.userId,
    contactId: args.contactId,
    type: "email_address",
    value: normalizedEmail,
    confidence: 0.95,
    sourceSystem: "gmail",
    // Keep one canonical fact per address, while preserving a current
    // source excerpt that points back to the Gmail evidence trail.
    sourceRecordId: `gmail:address:${normalizedEmail}`,
    excerpt: buildEmailFactExcerpt(args.subject, args.snippet, args.emailMessageId),
    observedAt: args.observedAt,
  });
}

export async function loadPersonFactsForPrompt(
  prisma: PrismaClient,
  args: {
    readonly userId: string;
    readonly contactId: string;
    readonly limit?: number;
  },
): Promise<PromptPersonFact[]> {
  return prisma.personFact.findMany({
    where: {
      userId: args.userId,
      contactId: args.contactId,
      dismissedAt: null,
    },
    orderBy: [
      { confirmedByUser: "desc" },
      { confidence: "desc" },
      { observedAt: "desc" },
    ],
    take: args.limit ?? 8,
    select: {
      id: true,
      type: true,
      value: true,
      confidence: true,
      sourceSystem: true,
      sourceRecordId: true,
      excerpt: true,
      confirmedByUser: true,
      observedAt: true,
    },
  });
}

export function buildPersonFactsPromptBlock(facts: PromptPersonFact[]): string {
  if (facts.length === 0) return "";

  const lines = facts.map((fact) => {
    const confirmation = fact.confirmedByUser ? "confirmed" : "inferred";
    const confidence = `${Math.round(fact.confidence * 100)}%`;
    return `- ${labelForFactType(fact.type)}: ${fact.value} (${confirmation}, ${confidence}, source: ${fact.sourceSystem})`;
  });

  return `SOURCE-BACKED FACTS ABOUT THEM:\n${lines.join("\n")}`;
}

function buildEmailFactExcerpt(
  subject: string | null | undefined,
  snippet: string | null | undefined,
  emailMessageId: string,
): string {
  const pieces = [
    subject ? `Subject: ${subject}` : null,
    snippet ? `Snippet: ${snippet.slice(0, 180)}` : null,
    `EmailMessage: ${emailMessageId}`,
  ].filter((p): p is string => Boolean(p));
  return pieces.join(" | ");
}

function labelForFactType(type: string): string {
  if (type === "email_address") return "Email address";
  if (type === "role") return "Role";
  if (type === "company") return "Company";
  if (type === "location") return "Location";
  if (type === "interest") return "Interest";
  if (type === "personal_context") return "Personal context";
  if (type === "open_loop") return "Open loop";
  return type.replace(/_/g, " ");
}
