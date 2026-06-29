import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Contact } from "@/generated/prisma/client";
import {
  patchContactListCaches,
  removeContactFromCaches,
  shouldInvalidateContactListCaches,
  type ContactWithCount,
} from "@/lib/hooks/use-contacts";

describe("contact cache helpers", () => {
  it("patches visible contact-list rows while preserving list-only fields", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<ContactWithCount[]>(
      ["contacts", { sort: "name" }],
      [contact("c1", "Ada Lovelace"), contact("c2", "Grace Hopper")],
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

  it("patches contact list and People bootstrap caches without changing cache shape", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<ContactWithCount[]>(
      ["contacts", { sort: "name" }],
      [contact("c1", "Ada"), contact("c2", "Grace")],
    );
    queryClient.setQueryData(
      ["contacts", "people-bootstrap", { sort: "name" }],
      {
        contacts: [contact("c1", "Ada"), contact("c2", "Grace")],
        circles: [{ id: "circle-1", name: "Research", color: "#6B8A6E" }],
        totalPendingDuplicates: 2,
      },
    );

    patchContactListCaches(queryClient, {
      id: "c1",
      name: "Ada Lovelace",
      company: "Analytical Engines",
    });

    expect(
      queryClient.getQueryData<ContactWithCount[]>(["contacts", { sort: "name" }]),
    ).toEqual([
      expect.objectContaining({
        id: "c1",
        name: "Ada Lovelace",
        company: "Analytical Engines",
      }),
      expect.objectContaining({ id: "c2", name: "Grace" }),
    ]);

    const people = queryClient.getQueryData<{
      contacts: ContactWithCount[];
      circles: { id: string }[];
      totalPendingDuplicates: number;
    }>(["contacts", "people-bootstrap", { sort: "name" }]);
    expect(people?.contacts).toEqual([
      expect.objectContaining({
        id: "c1",
        name: "Ada Lovelace",
        company: "Analytical Engines",
      }),
      expect.objectContaining({ id: "c2", name: "Grace" }),
    ]);
    expect(people?.circles).toEqual([
      { id: "circle-1", name: "Research", color: "#6B8A6E" },
    ]);
    expect(people?.totalPendingDuplicates).toBe(2);
  });

  it("removes deleted contacts from contact list and People bootstrap caches", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<ContactWithCount[]>(
      ["contacts", { sort: "name" }],
      [contact("c1", "Ada"), contact("c2", "Grace")],
    );
    queryClient.setQueryData(
      ["contacts", "people-bootstrap", { circle: "circle-1" }],
      {
        contacts: [contact("c1", "Ada"), contact("c2", "Grace")],
        circles: [{ id: "circle-1", name: "Research", color: "#6B8A6E" }],
        totalPendingDuplicates: 0,
      },
    );

    removeContactFromCaches(queryClient, "c1");

    expect(
      queryClient.getQueryData<ContactWithCount[]>(["contacts", { sort: "name" }]),
    ).toEqual([expect.objectContaining({ id: "c2", name: "Grace" })]);
    expect(
      queryClient.getQueryData<{ contacts: ContactWithCount[] }>([
        "contacts",
        "people-bootstrap",
        { circle: "circle-1" },
      ])?.contacts,
    ).toEqual([expect.objectContaining({ id: "c2", name: "Grace" })]);
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

function contact(id: string, name: string): ContactWithCount {
  return {
    id,
    name,
    email: null,
    additionalEmails: [],
    phone: null,
    company: null,
    role: null,
    tier: "PROFESSIONAL",
    source: "MANUAL",
    tags: [],
    linkedinUrl: null,
    avatarUrl: null,
    city: null,
    state: null,
    country: null,
    notes: null,
    followUpDays: null,
    lastInteraction: null,
    importedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    _count: { interactions: 3 },
    circles: [
      { circle: { id: "circle-1", name: "Research", color: "#6B8A6E" } },
    ],
  };
}
