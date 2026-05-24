import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createGmailDraft } from "@/lib/gmail/drafts";

interface SaveToGmailBody {
  recipientEmail?: string;
  threadId?: string;
  inReplyToMessageId?: string;
  references?: string;
  isReply?: boolean;
}

/**
 * Push a CRM Draft into Gmail as a real draft. Idempotent for the same
 * Draft row — re-calling updates the existing Gmail draft via PUT
 * rather than creating duplicates.
 *
 * Body lets callers override the recipient and threading info inferred
 * from the contact + thread context; pass only what differs from defaults.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const draft = await prisma.draft.findUnique({
    where: { id },
    include: { contact: { select: { id: true, name: true, email: true } } },
  });
  if (!draft || draft.userId !== session.user.id) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  let body: SaveToGmailBody = {};
  try {
    body = (await req.json()) as SaveToGmailBody;
  } catch {
    // Empty body is fine — fall through to inferred defaults.
  }

  const recipient = body.recipientEmail ?? draft.contact.email;
  if (!recipient) {
    return NextResponse.json(
      { error: "No recipient email on file for this contact" },
      { status: 400 },
    );
  }

  // The connected Google account's email. We pick the user's primary
  // email; if multiple Google accounts are linked, the first one wins
  // (matches the existing googleFetch convention).
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });
  const from = user?.email;
  if (!from) {
    return NextResponse.json(
      { error: "Sender email unavailable" },
      { status: 400 },
    );
  }

  try {
    const result = await createGmailDraft(session.user.id, {
      from,
      to: recipient,
      subject: draft.subjectLine ?? "",
      body: draft.content,
      threadId: body.threadId ?? draft.gmailThreadId,
      inReplyToMessageId: body.inReplyToMessageId ?? draft.inReplyToMessageId,
      references: body.references,
      existingDraftId: draft.gmailDraftId,
      isReply: body.isReply ?? draft.type === "REPLY_EMAIL",
    });

    await prisma.draft.update({
      where: { id: draft.id },
      data: {
        gmailDraftId: result.draftId,
        gmailThreadId: result.threadId,
        recipientEmail: recipient,
        inReplyToMessageId: body.inReplyToMessageId ?? draft.inReplyToMessageId,
        savedToGmailAt: new Date(),
      },
    });

    return NextResponse.json({
      gmailDraftId: result.draftId,
      gmailThreadId: result.threadId,
      // Gmail web deep-link. The /u/0 segment is hard-coded but Google
      // resolves it relative to whatever account is signed in — close
      // enough for a deep-link with one Google account.
      deepLinkUrl: `https://mail.google.com/mail/u/0/#drafts/${result.draftId}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
