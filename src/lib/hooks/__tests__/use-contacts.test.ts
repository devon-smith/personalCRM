import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Contact } from "@/generated/prisma/client";
import type { ContactWithCount } from "@/lib/hooks/use-contacts";
import {
  patchContactListCaches,
  shouldInvalidateContactListCaches,
} from "@/lib/hooks/use-contacts";

describe("contact cache helpers", () => {
  it("patches visible contact-list rows while preserving list-only fields", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<ContactWithCount[]>(
      ["contacts", { sort: "name" }],
      [
        contactListItem("c1", "Ada Lovelace"),
        contactListItem("c2", "Grace Hopper"),
      ],
    );

    patchContactListCaches(queryClient, {
      id: "c1",
      notes: "Prefers short updates.",
      linkedinUrl: "https://linkedin.com/in/ada",
    } as Partial<Contact> & { id: string });

    const list = queryClient.getQueryData<ContactWithCount[]>([
      "contacts",
      { sort: "name" },
    ]);
    expect(list?.[0]).toMatchObject({
      id: "c1",
      name: "Ada Lovelace",
      notes: "Prefers short updates.",
      linkedinUrl: "https://linkedin.com/in/ada",
      _count: { interactions: 3 },
    });
    expect(list?.[0].circles).toHaveLength(1);
  });

  it("only invalidates contact lists for edits that affect membership or sorting", () => {
    expect(
      shouldInvalidateContactListCaches({
        id: "c1",
        notes: "Updated",
        howWeMet: "Conference",
        linkedinUrl: "https://linkedin.com/in/ada",
      } as Partial<Contact> & { id: string }),
    ).toBe(false);

    expect(
      shouldInvalidateContactListCaches({
        id: "c1",
        name: "Ada Byron",
      } as Partial<Contact> & { id: string }),
    ).toBe(true);

    expect(
      shouldInvalidateContactListCaches({
        id: "c1",
        tier: "INNER_CIRCLE",
      } as Partial<Contact> & { id: string }),
    ).toBe(true);
  });
});

function contactListItem(id: string, name: string): ContactWithCount {
  return {
    id,
    name,
    notes: null,
    linkedinUrl: null,
    circles: [
      { circle: { id: "circle-1", name: "Research", color: "#6B8A6E" } },
    ],
    _count: { interactions: 3 },
  } as unknown as ContactWithCount;
}
