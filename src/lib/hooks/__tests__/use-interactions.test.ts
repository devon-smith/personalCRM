import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Interaction } from "@/generated/prisma/client";
import type {
  ContactWithCount,
  ContactWithDetails,
} from "@/lib/hooks/use-contacts";
import { patchLoggedInteractionCaches } from "@/lib/hooks/use-interactions";

describe("patchLoggedInteractionCaches", () => {
  it("patches contact detail, summary, and list caches from the created interaction", () => {
    const queryClient = new QueryClient();
    const oldInteraction = interaction("i-old", "c1", "2026-06-01T12:00:00.000Z");
    const newInteraction = interaction("i-new", "c1", "2026-06-29T12:00:00.000Z");

    queryClient.setQueryData<ContactWithDetails>(
      ["contact", "c1"],
      {
        ...contact("c1", "Ada Lovelace", "2026-06-01T12:00:00.000Z", 1),
        interactions: [oldInteraction],
        circles: [],
      } as unknown as ContactWithDetails,
    );
    queryClient.setQueryData<ContactWithCount>(
      ["contact-summary", "c1"],
      contact("c1", "Ada Lovelace", "2026-06-01T12:00:00.000Z", 1),
    );
    queryClient.setQueryData<ContactWithCount[]>(
      ["contacts", { sort: "lastInteraction" }],
      [
        contact("c2", "Grace Hopper", "2026-06-15T12:00:00.000Z", 4),
        contact("c1", "Ada Lovelace", "2026-06-01T12:00:00.000Z", 1),
      ],
    );

    patchLoggedInteractionCaches(queryClient, newInteraction);

    const detail = queryClient.getQueryData<ContactWithDetails>(["contact", "c1"]);
    expect(detail?.lastInteraction).toEqual(newInteraction.occurredAt);
    expect(detail?.interactions.map((item) => item.id)).toEqual(["i-new", "i-old"]);

    const summary = queryClient.getQueryData<ContactWithCount>(["contact-summary", "c1"]);
    expect(summary?.lastInteraction).toEqual(newInteraction.occurredAt);
    expect(summary?._count.interactions).toBe(2);

    const list = queryClient.getQueryData<ContactWithCount[]>([
      "contacts",
      { sort: "lastInteraction" },
    ]);
    expect(list?.map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(list?.[0]._count.interactions).toBe(2);
  });
});

function contact(
  id: string,
  name: string,
  lastInteraction: string,
  interactionCount: number,
): ContactWithCount {
  return {
    id,
    name,
    lastInteraction: new Date(lastInteraction),
    _count: { interactions: interactionCount },
  } as unknown as ContactWithCount;
}

function interaction(
  id: string,
  contactId: string,
  occurredAt: string,
): Interaction {
  return {
    id,
    contactId,
    occurredAt: new Date(occurredAt),
  } as unknown as Interaction;
}
