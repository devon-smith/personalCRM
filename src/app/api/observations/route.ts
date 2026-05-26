import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dropAnsweredByThread } from "@/lib/intelligence/generate-observations";

/**
 * GET /api/observations
 *
 * Returns the user's undismissed assistant observations, newest
 * first. UI on the dashboard typically renders 1-2 at a time.
 *
 * Render-time stale-check (M0.5): for `unanswered_inbound`
 * observations, re-verify against the underlying thread before
 * returning. If the user has since replied (any OUTBOUND in the
 * same threadId after the inbound), drop from the response and
 * auto-dismiss the row. This handles observations created by an
 * earlier worker run that have since been resolved.
 *
 * Mark-as-shown happens lazily on render (PATCH not required) —
 * the existence of an observation is enough; we don't need
 * impression tracking for v1.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // Pull a few extra so the stale-filter doesn't starve the response.
  const observations = await prisma.assistantObservation.findMany({
    where: { userId, dismissedAt: null },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      id: true,
      content: true,
      contactId: true,
      source: true,
      sourceRefs: true,
      createdAt: true,
    },
  });

  // Resolve source interactions only for unanswered_inbound rows.
  const inboundRefs = observations
    .filter((o) => o.source === "unanswered_inbound")
    .map((o) => extractInteractionId(o.sourceRefs))
    .filter((id): id is string => id !== null);

  let staleObservationIds = new Set<string>();
  if (inboundRefs.length > 0) {
    const interactions = await prisma.interaction.findMany({
      where: { id: { in: inboundRefs }, userId },
      select: { id: true, threadId: true, occurredAt: true },
    });
    const live = await dropAnsweredByThread(prisma, userId, interactions);
    const liveIds = new Set(live.map((i) => i.id));
    const stale = interactions
      .filter((i) => !liveIds.has(i.id))
      .map((i) => i.id);

    if (stale.length > 0) {
      // Map source-interaction-ids back to observation ids.
      const staleSet = new Set(stale);
      staleObservationIds = new Set(
        observations
          .filter((o) => {
            const refId = extractInteractionId(o.sourceRefs);
            return refId !== null && staleSet.has(refId);
          })
          .map((o) => o.id),
      );

      // Auto-dismiss the stale rows so they stop appearing.
      // Fire and forget on the network side, but await here to
      // keep the next render consistent.
      await prisma.assistantObservation.updateMany({
        where: { id: { in: Array.from(staleObservationIds) }, userId },
        data: { dismissedAt: new Date() },
      });
    }
  }

  const filtered = observations
    .filter((o) => !staleObservationIds.has(o.id))
    .slice(0, 5)
    .map(({ sourceRefs: _refs, ...rest }) => {
      void _refs;
      return rest;
    });

  return NextResponse.json({ observations: filtered });
}

/**
 * `sourceRefs` is a JSON array of strings like `"interaction:<uuid>"`.
 * Returns the first interaction id found, or null. Defensive against
 * legacy shapes — the worker only writes `interaction:...` refs but
 * we don't want a misshapen row to crash the response.
 */
function extractInteractionId(refs: unknown): string | null {
  if (!Array.isArray(refs)) return null;
  for (const r of refs) {
    if (typeof r !== "string") continue;
    if (r.startsWith("interaction:")) return r.slice("interaction:".length);
  }
  return null;
}
