import { prisma } from "../src/lib/prisma";
import {
  findDraftQualityIssues,
  generateDraft,
} from "../src/lib/draft-generator";
import { loadReplyContext } from "../src/lib/draft-reply-context";
import type { DraftTone } from "../src/lib/draft-composer-context";
import type { WorkspaceVersion } from "../src/lib/drafts/workspace-types";

const APPLY = process.argv.includes("--apply");

const STALE_CONTENT_FILTER = {
  OR: [
    {
      content: {
        contains: "appreciate you sending this over",
        mode: "insensitive" as const,
      },
    },
    {
      content: {
        contains: "take a closer look",
        mode: "insensitive" as const,
      },
    },
    {
      content: {
        contains: "follow up with thoughts by end of week",
        mode: "insensitive" as const,
      },
    },
    {
      content: {
        contains: "INSERT_MOMS",
        mode: "insensitive" as const,
      },
    },
  ],
};

async function main() {
  const candidates = await prisma.draft.findMany({
    where: {
      type: "REPLY_EMAIL",
      status: "DRAFT",
      savedToGmailAt: null,
      OR: [
        ...STALE_CONTENT_FILTER.OR,
        { threadKey: { not: null } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      contactId: true,
      tone: true,
      content: true,
      threadKey: true,
      inboxItemId: true,
      createdAt: true,
      contact: { select: { name: true, email: true, additionalEmails: true } },
    },
  });

  const stale = [];
  for (const draft of candidates) {
    const issues = findDraftQualityIssues(
      { quick: draft.content, detailed: draft.content },
      { context: "catching_up", replyContext: null },
    );

    if (draft.threadKey) {
      const replyContext = await loadReplyContext({
        prisma,
        userId: draft.userId,
        threadKey: draft.threadKey,
      }).catch(() => null);
      const inboundEmail = replyContext?.latestInbound.fromEmail
        ?.trim()
        .toLowerCase();
      if (inboundEmail && !contactHasEmail(draft.contact, inboundEmail)) {
        issues.push(
          `draft contact (${draft.contact.name}) does not match latest inbound sender (${replyContext?.latestInbound.fromName ?? inboundEmail})`,
        );
      }
    }

    if (issues.length > 0) stale.push({ draft, issues });
  }

  const result = {
    mode: APPLY ? "apply" : "dry-run",
    candidates: candidates.length,
    stale: stale.length,
    regenerated: 0,
    skipped: [] as Array<{ id: string; contactName: string; reason: string }>,
  };

  for (const { draft, issues } of stale) {
    const contactName = draft.contact.name;
    if (!APPLY) {
      result.skipped.push({
        id: draft.id,
        contactName,
        reason: `dry-run: ${issues.join("; ")}`,
      });
      continue;
    }

    if (!draft.threadKey) {
      result.skipped.push({
        id: draft.id,
        contactName,
        reason: "missing threadKey",
      });
      continue;
    }

    const replyContext = await loadReplyContext({
      prisma,
      userId: draft.userId,
      threadKey: draft.threadKey,
    });

    if (!replyContext) {
      result.skipped.push({
        id: draft.id,
        contactName,
        reason: "could not load reply context",
      });
      continue;
    }

    const generated = await generateDraft({
      contactId: draft.contactId,
      userId: draft.userId,
      tone: draft.tone as DraftTone,
      context: "reply_email",
      threadKey: draft.threadKey,
      replyContext,
    });

    const generatedIssues = findDraftQualityIssues(generated, {
      context: "reply_email",
      replyContext,
    });

    if (generatedIssues.length > 0) {
      result.skipped.push({
        id: draft.id,
        contactName,
        reason: `generated draft failed quality gate: ${generatedIssues.join("; ")}`,
      });
      continue;
    }

    const version: WorkspaceVersion = {
      version: 1,
      content: generated.detailed,
      subjectLine: generated.subjectLine,
      generatedAt: new Date().toISOString(),
      sourceRequest: "regenerated stale generic reply draft",
      source: "initial",
    };

    await prisma.draft.update({
      where: { id: draft.id },
      data: {
        contactId: generated.resolvedContactId ?? draft.contactId,
        content: generated.detailed,
        subjectLine: generated.subjectLine,
        isWorkspaceDraft: true,
        workspaceVersions: [version] as unknown as object,
        refinementChat: [] as unknown as object,
      },
    });
    result.regenerated += 1;
  }

  console.log(JSON.stringify(result, null, 2));
}

function contactHasEmail(
  contact: { email: string | null; additionalEmails: string[] },
  email: string,
): boolean {
  if (contact.email?.toLowerCase() === email) return true;
  return contact.additionalEmails.some((candidate) => candidate.toLowerCase() === email);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
