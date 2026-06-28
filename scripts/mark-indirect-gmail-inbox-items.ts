/**
 * One-shot: hide open Gmail InboxItems whose trigger message was not
 * directly addressed to one of the user's email addresses.
 *
 * Run after a Gmail resync so EmailMessage.toEmail has been refreshed
 * from the latest To/Cc-aware ingestion logic.
 *
 *   npx tsx scripts/mark-indirect-gmail-inbox-items.ts --dry-run
 *   npx tsx scripts/mark-indirect-gmail-inbox-items.ts
 */

import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

interface Candidate {
  itemId: string;
  userId: string;
  contactName: string;
  sourceId: string;
  toEmail: string;
  subject: string | null;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const prismaModule = await import("../src/lib/prisma");
  const prisma = prismaModule.prisma ??
    (prismaModule as unknown as { default: typeof prismaModule }).default.prisma;

  console.log(`[mark-indirect-gmail-inbox-items] start dryRun=${dryRun}`);

  const [users, openItems] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        gmailSync: { select: { additionalUserEmails: true } },
      },
    }),
    prisma.inboxItem.findMany({
      where: {
        status: "OPEN",
        channel: "email",
        sourceSystem: "gmail",
        OR: [{ needsResponse: null }, { needsResponse: true }],
      },
      select: {
        id: true,
        userId: true,
        contactName: true,
        triggerInteractionId: true,
      },
    }),
  ]);

  const userEmails = new Map<string, Set<string>>();
  for (const user of users) {
    const emails = new Set<string>();
    if (user.email) emails.add(user.email.toLowerCase());
    for (const email of user.gmailSync?.additionalUserEmails ?? []) {
      emails.add(email.toLowerCase());
    }
    userEmails.set(user.id, emails);
  }

  const interactionIds = openItems.map((item) => item.triggerInteractionId);
  const interactions = await prisma.interaction.findMany({
    where: { id: { in: interactionIds } },
    select: { id: true, userId: true, sourceId: true },
  });
  const interactionsById = new Map(interactions.map((ix) => [ix.id, ix]));
  const sourceIds = interactions
    .map((ix) => ix.sourceId)
    .filter((sourceId): sourceId is string => Boolean(sourceId));

  const emailMessages = await prisma.emailMessage.findMany({
    where: {
      gmailId: { in: sourceIds },
      direction: "INBOUND",
    },
    select: {
      userId: true,
      gmailId: true,
      toEmail: true,
      subject: true,
    },
  });
  const emailByUserAndGmailId = new Map(
    emailMessages.map((email) => [`${email.userId}:${email.gmailId}`, email]),
  );

  const candidates: Candidate[] = [];
  for (const item of openItems) {
    const ix = interactionsById.get(item.triggerInteractionId);
    if (!ix?.sourceId) continue;

    const email = emailByUserAndGmailId.get(`${item.userId}:${ix.sourceId}`);
    if (!email) continue;

    const addresses = userEmails.get(item.userId) ?? new Set<string>();
    if (addresses.has(email.toEmail.toLowerCase())) continue;

    candidates.push({
      itemId: item.id,
      userId: item.userId,
      contactName: item.contactName,
      sourceId: ix.sourceId,
      toEmail: email.toEmail,
      subject: email.subject,
    });
  }

  if (dryRun) {
    for (const c of candidates) {
      console.log(
        `[would-hide] ${c.contactName} to=${c.toEmail || "(none)"} ` +
          `subject=${c.subject ?? "(no subject)"} source=${c.sourceId}`,
      );
    }
  } else if (candidates.length > 0) {
    await prisma.inboxItem.updateMany({
      where: { id: { in: candidates.map((c) => c.itemId) } },
      data: {
        needsResponse: false,
        responseConfidence: 0.99,
        responseReason: "Not directly addressed to one of your email addresses.",
        responseCategory: "not_addressed",
        classifiedAt: new Date(),
      },
    });
  }

  console.log(
    `[mark-indirect-gmail-inbox-items] done scanned=${openItems.length} ` +
      `hidden=${candidates.length} dryRun=${dryRun}`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[mark-indirect-gmail-inbox-items] failed:", err);
  process.exit(1);
});
