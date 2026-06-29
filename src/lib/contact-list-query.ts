import { Prisma } from "@/generated/prisma/client";

const VALID_SOURCES = new Set([
  "MANUAL",
  "CSV_IMPORT",
  "GOOGLE_CONTACTS",
  "GMAIL_DISCOVER",
  "APPLE_CONTACTS",
  "IMESSAGE",
  "LINKEDIN",
  "WHATSAPP",
]);

const VALID_TIERS = new Set(["INNER_CIRCLE", "PROFESSIONAL", "ACQUAINTANCE"]);

export class ContactListQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactListQueryError";
  }
}

export const contactListSelect = {
  id: true,
  name: true,
  email: true,
  additionalEmails: true,
  phone: true,
  company: true,
  role: true,
  tier: true,
  source: true,
  tags: true,
  linkedinUrl: true,
  avatarUrl: true,
  city: true,
  state: true,
  country: true,
  notes: true,
  followUpDays: true,
  lastInteraction: true,
  importedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { interactions: true } },
  circles: {
    select: {
      circle: { select: { id: true, name: true, color: true } },
    },
  },
} satisfies Prisma.ContactSelect;

export type ContactListItem = Prisma.ContactGetPayload<{
  select: typeof contactListSelect;
}>;

export function buildContactListQuery(searchParams: URLSearchParams, userId: string) {
  const search = searchParams.get("search") ?? "";
  const tier = searchParams.get("tier");
  const source = searchParams.get("source");
  const circle = searchParams.get("circle");
  const tag = searchParams.get("tag");
  const sort = searchParams.get("sort") ?? "name";
  // System-artifact contacts ("Settings", "noreply@...") are hidden by
  // default. Pass ?includeNoise=1 to surface them.
  const includeNoise = searchParams.get("includeNoise") === "1";

  if (tier && !VALID_TIERS.has(tier)) {
    throw new ContactListQueryError("Invalid tier");
  }
  if (source && !VALID_SOURCES.has(source)) {
    throw new ContactListQueryError("Invalid source");
  }

  const where: Prisma.ContactWhereInput = {
    userId,
    ...(includeNoise ? {} : { isNoise: false }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { additionalEmails: { has: search } },
        { company: { contains: search, mode: "insensitive" } },
      ],
    }),
    ...(tier && { tier: tier as Prisma.EnumContactTierFilter["equals"] }),
    ...(circle && { circles: { some: { circleId: circle } } }),
    ...(source && { source: source as Prisma.EnumContactSourceFilter["equals"] }),
    ...(tag && { tags: { has: tag } }),
  };

  const orderBy: Prisma.ContactOrderByWithRelationInput =
    sort === "lastInteraction"
      ? { lastInteraction: { sort: "desc", nulls: "last" } }
      : sort === "createdAt"
        ? { createdAt: "desc" }
        : { name: "asc" };

  const take = Math.min(Number(searchParams.get("limit")) || 500, 1000);

  return { where, orderBy, take };
}
