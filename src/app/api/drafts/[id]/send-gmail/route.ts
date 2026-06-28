import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createGmailDraft, sendGmailDraft } from "@/lib/gmail/drafts";
import { onOutboundInteraction } from "@/lib/inbox";
import { invalidateInboxCache } from "@/app/api/inbox-items/route";

interface SendBody {
  recipientEmail?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const draft = await prisma.draft.findFirst({
    where: { id, userId },
    include: {
      contact: { select: { id: true, name: true, email: true } },
      inboxItem: { select: { id: true, threadKey: true } },
    },
  });
  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  if (draft.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Only draft-status messages can be sent" },
      { status: 400 },
    );
  }

  let body: SendBody = {};
  try {
    body = (await req.json()) as SendBody;
  } catch {
    // Empty body is fine.
  }

  const recipient = body.recipientEmail ?? draft.recipientEmail ?? draft.contact.email;
  if (!recipient) {
    return NextResponse.json(
      { error: "No recipient email on file for this contact" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user?.email) {
    return NextResponse.json(
      { error: "Sender email unavailable" },
      { status: 400 },
    );
  }

  const inferredThreadId =
    draft.gmailThreadId ??
    (draft.threadKey?.startsWith("gmail:") ? draft.threadKey.slice(6) : null) ??
    (draft.inboxItem?.threadKey.startsWith("gmail:")
      ? draft.inboxItem.threadKey.slice(6)
      : null);

  try {
    const saved = await createGmailDraft(userId, {
      from: user.email,
      to: recipient,
      subject: draft.subjectLine ?? "",
      body: draft.content,
      threadId: inferredThreadId,
      inReplyToMessageId: draft.inReplyToMessageId,
      existingDraftId: draft.gmailDraftId,
      isReply: draft.type === "REPLY_EMAIL",
    });

    const sent = await sendGmailDraft(userId, saved.draftId);
    const sentAt = new Date();
    const threadId = sent.threadId || saved.threadId || inferredThreadId;

    await prisma.$transaction(async (tx) => {
      await tx.draft.update({
        where: { id: draft.id },
        data: {
          status: "SENT",
          sentAt,
          gmailDraftId: saved.draftId,
          gmailThreadId: threadId,
          recipientEmail: recipient,
          savedToGmailAt: sentAt,
        },
      });

      const existingInteraction = await tx.interaction.findFirst({
        where: { userId, sourceId: sent.messageId },
        select: { id: true },
      });
      if (!existingInteraction) {
        await tx.interaction.create({
          data: {
            userId,
            contactId: draft.contactId,
            type: "EMAIL",
            direction: "OUTBOUND",
            channel: "gmail",
            subject: draft.subjectLine,
            summary: draft.content.slice(0, 500),
            occurredAt: sentAt,
            sourceId: sent.messageId,
            chatId: threadId ? `gmail:${threadId}` : `1:1:${draft.contactId}:email`,
          },
        });
      }

      await tx.contact.update({
        where: { id: draft.contactId },
        data: { lastInteraction: sentAt },
      });

      if (draft.inboxItemId) {
        await tx.inboxItem.updateMany({
          where: { id: draft.inboxItemId, userId },
          data: {
            status: "RESOLVED",
            resolvedAt: sentAt,
            resolvedBy: "gmail_send",
          },
        });
      }
    });

    if (threadId) {
      await onOutboundInteraction(userId, draft.contactId, "gmail", sentAt, {
        threadKey: `gmail:${threadId}`,
      });
    }
    invalidateInboxCache();

    return NextResponse.json({
      ok: true,
      status: "SENT",
      gmailDraftId: saved.draftId,
      gmailMessageId: sent.messageId,
      gmailThreadId: threadId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
