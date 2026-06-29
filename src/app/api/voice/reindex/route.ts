import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueue } from "../../../../../worker/queue-client";
import { detectSignatureLines } from "@/lib/voice/signature-detector";
import { stripDetectedSignatures } from "@/lib/voice/feature-extraction";

/**
 * POST /api/voice/reindex
 *
 * Three modes via query params:
 *
 * - `?dryRun=1` — synchronous. Runs signature detection against the
 *   current corpus and returns the detected lines + frequencies + a
 *   before/after preview on 3 sample emails. NO writes, NO worker
 *   enqueue. Use this to eyeball what would be stripped before
 *   committing to a destructive rebuild.
 *
 * - `?rebuild=1` — enqueues voice-corpus-index with rebuild=true.
 *   Re-extracts features for ALL existing VoiceExample rows using the
 *   freshly-detected signatureLines. Re-embeds where possible. This
 *   is destructive — only run after eyeballing dryRun output.
 *
 * - (no params) — incremental. Enqueues a normal pass that only
 *   processes emails without an existing VoiceExample.
 */

const SAMPLE_PREVIEW_COUNT = 3;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const rebuild = url.searchParams.get("rebuild") === "1";

  if (dryRun) {
    return runDryRun(session.user.id);
  }

  const mode = rebuild ? "rebuild" : "incremental";
  const jobId = await enqueue(
    "voice-corpus-index",
    {
      userId: session.user.id,
      rebuild,
    },
    {
      queueName: `voice-corpus-index:${session.user.id}`,
      jobKey: `voice-corpus-index:${session.user.id}:${mode}`,
      jobKeyMode: "preserve_run_at",
    },
  );
  return NextResponse.json({ ok: true, jobId, rebuild });
}

async function runDryRun(userId: string) {
  const bodies = await prisma.emailMessage.findMany({
    where: {
      userId,
      direction: "OUTBOUND",
      isAutomated: false,
      fullBody: { not: null },
    },
    orderBy: { occurredAt: "desc" },
    take: 1000,
    select: { id: true, subject: true, toEmail: true, fullBody: true },
  });
  const texts = bodies
    .map((b) => b.fullBody)
    .filter((b): b is string => b !== null);
  const detection = detectSignatureLines(texts);

  // Build before/after previews for the first few emails. Helps the
  // user spot false positives (sig stripping eating real content) and
  // false negatives (a known sig line not being detected).
  const previews = bodies.slice(0, SAMPLE_PREVIEW_COUNT).map((b) => {
    const before = b.fullBody ?? "";
    const after = stripDetectedSignatures(before, detection.lines);
    const charsStripped = before.length - after.length;
    return {
      subject: b.subject,
      toEmail: b.toEmail,
      charsStripped,
      bodyBeforePreview: before.slice(-300),
      bodyAfterPreview: after.slice(-300),
    };
  });

  return NextResponse.json({
    dryRun: true,
    corpusSize: detection.corpusSize,
    detectedLines: detection.lines,
    frequencies: detection.frequencies,
    samplePreviews: previews,
  });
}
