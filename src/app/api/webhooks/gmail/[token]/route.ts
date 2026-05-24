import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueue } from "../../../../../../worker/queue-client";

/**
 * POST /api/webhooks/gmail/[token]
 *
 * Receives Pub/Sub push deliveries from Gmail's users.watch. Each
 * message body is:
 *   { message: { data: <base64-json>, messageId, publishTime } }
 * where data decodes to: { emailAddress, historyId }.
 *
 * On a valid message we enqueue a gmail-sync job for that user. Gmail
 * doesn't tell us WHAT changed — just that something did — so we run
 * the existing incremental sync which diffs against the stored
 * historyId.
 *
 * Auth: the [token] path segment must match WEBHOOK_TOKEN. Pub/Sub
 * doesn't authenticate itself by default; a shared-secret URL is the
 * simplest gate. For higher-strength setups, swap to OIDC token
 * verification on the `Authorization` header (Pub/Sub can sign deliveries).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!process.env.WEBHOOK_TOKEN || token !== process.env.WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { message?: { data?: string } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dataB64 = body.message?.data;
  if (!dataB64) {
    // Pub/Sub sometimes sends empty/test messages — ack with 200 so
    // it doesn't redeliver.
    return NextResponse.json({ ok: true });
  }

  let payload: { emailAddress?: string; historyId?: string };
  try {
    payload = JSON.parse(Buffer.from(dataB64, "base64").toString("utf8"));
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  const email = payload.emailAddress?.toLowerCase();
  if (!email) return NextResponse.json({ ok: true });

  // Map email → userId via the User row (primary) OR the additional
  // emails list on GmailSyncState (linked secondary accounts).
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  const userId =
    user?.id ??
    (
      await prisma.gmailSyncState.findFirst({
        where: { additionalUserEmails: { has: email } },
        select: { userId: true },
      })
    )?.userId;

  if (!userId) {
    // Unknown email — could be a stale watch from a deleted user.
    // Ack so Pub/Sub stops retrying.
    return NextResponse.json({ ok: true });
  }

  // Enqueue a dedicated job. Worker dedups via queue concurrency so
  // multiple webhooks fired close together don't double-sync.
  try {
    await enqueue("gmail-sync", { triggeredBy: "webhook", userId });
  } catch (err) {
    // Best-effort: even if the enqueue fails, the cron-scheduled
    // gmail-sync will pick up the new historyId on its next run.
    console.error("[webhook/gmail] enqueue failed:", err);
  }

  return NextResponse.json({ ok: true });
}
