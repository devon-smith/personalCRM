import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  gatherMorningBrief,
  renderBriefHtml,
  renderBriefText,
  buildBriefSubject,
} from "@/lib/morning-brief";
import { enqueue } from "../../../../../../worker/queue-client";

/**
 * Brief preview + manual trigger. Single-user app; the auth gate is
 * the perimeter — anyone signed in can hit this for their own user.
 *
 * GET  /api/admin/morning-brief/preview
 *   → ?format=html  HTML email body (rendered inline so the browser shows it)
 *   → ?format=text  plain-text fallback
 *   → ?format=json  full BriefData payload + subject (default)
 *
 * POST /api/admin/morning-brief/preview
 *   → enqueues the worker task with { userId, force: true } so today's
 *     draft gets re-rendered immediately, replacing any prior draft.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "json";
  const appBaseUrl =
    process.env.WEBHOOK_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    url.origin;

  const data = await gatherMorningBrief(session.user.id, appBaseUrl);
  if (!data) {
    return NextResponse.json({ error: "No user email on file" }, { status: 404 });
  }

  if (format === "html") {
    return new NextResponse(renderBriefHtml(data), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (format === "text") {
    return new NextResponse(renderBriefText(data), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.json({
    subject: buildBriefSubject(data),
    data,
  });
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const jobId = await enqueue("morning-brief", {
    userId: session.user.id,
    force: true,
  });
  return NextResponse.json({ ok: true, jobId });
}
