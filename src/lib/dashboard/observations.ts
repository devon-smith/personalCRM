import { prisma } from "@/lib/prisma";
import { dropAnsweredByThread } from "@/lib/intelligence/generate-observations";

export interface DashboardObservation {
  id: string;
  content: string;
  contactId: string | null;
  source: string;
  createdAt: string;
}

export async function getDashboardObservations(
  userId: string,
  limit = 5,
): Promise<DashboardObservation[]> {
  // Pull a few extra so stale filtering does not starve the response.
  const observations = await prisma.assistantObservation.findMany({
    where: { userId, dismissedAt: null },
    orderBy: { createdAt: "desc" },
    take: Math.max(limit * 3, limit),
    select: {
      id: true,
      content: true,
      contactId: true,
      source: true,
      sourceRefs: true,
      createdAt: true,
    },
  });

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
      const staleSet = new Set(stale);
      staleObservationIds = new Set(
        observations
          .filter((o) => {
            const refId = extractInteractionId(o.sourceRefs);
            return refId !== null && staleSet.has(refId);
          })
          .map((o) => o.id),
      );

      await prisma.assistantObservation.updateMany({
        where: { id: { in: Array.from(staleObservationIds) }, userId },
        data: { dismissedAt: new Date() },
      });
    }
  }

  return observations
    .filter((o) => !staleObservationIds.has(o.id))
    .slice(0, limit)
    .map(({ sourceRefs: _refs, createdAt, ...rest }) => {
      void _refs;
      return {
        ...rest,
        createdAt: createdAt.toISOString(),
      };
    });
}

function extractInteractionId(refs: unknown): string | null {
  if (!Array.isArray(refs)) return null;
  for (const r of refs) {
    if (typeof r !== "string") continue;
    if (r.startsWith("interaction:")) return r.slice("interaction:".length);
  }
  return null;
}
