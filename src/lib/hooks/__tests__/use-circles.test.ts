import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  patchCircleMetadataCaches,
  removeCircleFromCaches,
  type CircleSummary,
  type CircleWithContacts,
} from "@/lib/hooks/use-circles";

describe("circle cache helpers", () => {
  it("patches full circle rows while preserving contacts and health", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<CircleWithContacts[]>(
      ["circles"],
      [
        circleWithContacts("c1", "Research", 1),
        circleWithContacts("c2", "Faculty", 0),
      ],
    );

    patchCircleMetadataCaches(queryClient, {
      id: "c1",
      name: "Research Partners",
      color: "#B5613F",
      sortOrder: 2,
      googleSyncEnabled: true,
      googleSyncedAt: "2026-06-29T12:00:00.000Z",
      googleSyncError: null,
    });

    const circles = queryClient.getQueryData<CircleWithContacts[]>(["circles"]);
    expect(circles?.map((circle) => circle.id)).toEqual(["c2", "c1"]);
    expect(circles?.[1]).toMatchObject({
      id: "c1",
      name: "Research Partners",
      color: "#B5613F",
      googleSyncEnabled: true,
      googleSyncedAt: "2026-06-29T12:00:00.000Z",
      googleSyncError: null,
      contacts: [{ id: "contact-c1" }],
      health: { good: 1, mid: 0, cold: 0 },
    });
  });

  it("patches summary and People filter circle caches", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<CircleSummary[]>(
      ["circles", "summary"],
      [
        circleSummary("c1", "Research", 1),
        circleSummary("c2", "Faculty", 0),
      ],
    );
    queryClient.setQueryData(
      ["contacts", "people-bootstrap", { sort: "name" }],
      {
        contacts: [],
        totalPendingDuplicates: 0,
        circles: [
          { id: "c1", name: "Research", color: "#6B8A6E" },
          { id: "c2", name: "Faculty", color: "#4B5563" },
        ],
      },
    );

    patchCircleMetadataCaches(queryClient, {
      id: "c1",
      name: "Research Partners",
      color: "#B5613F",
      sortOrder: 2,
    });

    const summaries = queryClient.getQueryData<CircleSummary[]>([
      "circles",
      "summary",
    ]);
    expect(summaries?.map((circle) => circle.id)).toEqual(["c2", "c1"]);
    expect(summaries?.[1]).toMatchObject({
      id: "c1",
      name: "Research Partners",
      color: "#B5613F",
    });

    const people = queryClient.getQueryData<{
      circles: { id: string; name: string; color: string }[];
    }>(["contacts", "people-bootstrap", { sort: "name" }]);
    expect(people?.circles.map((circle) => circle.id)).toEqual(["c1", "c2"]);
    expect(people?.circles[0]).toEqual({
      id: "c1",
      name: "Research Partners",
      color: "#B5613F",
    });
  });

  it("removes deleted circles from cached circle and People filter data", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<CircleWithContacts[]>(
      ["circles"],
      [
        circleWithContacts("c1", "Research", 1),
        circleWithContacts("c2", "Faculty", 0),
      ],
    );
    queryClient.setQueryData<CircleSummary[]>(
      ["circles", "summary"],
      [
        circleSummary("c1", "Research", 1),
        circleSummary("c2", "Faculty", 0),
      ],
    );
    queryClient.setQueryData(
      ["contacts", "people-bootstrap", { sort: "name" }],
      {
        contacts: [{ id: "contact-c1" }],
        totalPendingDuplicates: 0,
        circles: [
          { id: "c1", name: "Research", color: "#6B8A6E" },
          { id: "c2", name: "Faculty", color: "#4B5563" },
        ],
      },
    );
    queryClient.setQueryData(
      ["contacts", "people-bootstrap", { circle: "c1", sort: "name" }],
      {
        contacts: [{ id: "contact-c1" }],
        totalPendingDuplicates: 0,
        circles: [
          { id: "c1", name: "Research", color: "#6B8A6E" },
          { id: "c2", name: "Faculty", color: "#4B5563" },
        ],
      },
    );
    queryClient.setQueryData(["circle-intelligence", "c1"], { summary: "old" });
    queryClient.setQueryData(["circle-stories", "c1"], { stories: [] });

    removeCircleFromCaches(queryClient, "c1");

    expect(
      queryClient.getQueryData<CircleWithContacts[]>(["circles"])?.map((c) => c.id),
    ).toEqual(["c2"]);
    expect(
      queryClient.getQueryData<CircleSummary[]>(["circles", "summary"])?.map((c) => c.id),
    ).toEqual(["c2"]);

    const unfilteredPeople = queryClient.getQueryData<{
      contacts: { id: string }[];
      circles: { id: string }[];
    }>(["contacts", "people-bootstrap", { sort: "name" }]);
    expect(unfilteredPeople?.contacts).toEqual([{ id: "contact-c1" }]);
    expect(unfilteredPeople?.circles.map((circle) => circle.id)).toEqual(["c2"]);

    const deletedCirclePeople = queryClient.getQueryData<{
      contacts: { id: string }[];
      circles: { id: string }[];
    }>(["contacts", "people-bootstrap", { circle: "c1", sort: "name" }]);
    expect(deletedCirclePeople?.contacts).toEqual([]);
    expect(deletedCirclePeople?.circles.map((circle) => circle.id)).toEqual(["c2"]);

    expect(queryClient.getQueryData(["circle-intelligence", "c1"])).toBeUndefined();
    expect(queryClient.getQueryData(["circle-stories", "c1"])).toBeUndefined();
  });
});

function circleWithContacts(
  id: string,
  name: string,
  sortOrder: number,
): CircleWithContacts {
  return {
    ...circleSummary(id, name, sortOrder),
    contacts: [
      {
        id: `contact-${id}`,
        name: "Ada Lovelace",
        email: "ada@example.com",
        company: "Analytical Engines",
        avatarUrl: null,
        warmth: "good",
        daysSince: 1,
      },
    ],
    health: { good: 1, mid: 0, cold: 0 },
  };
}

function circleSummary(
  id: string,
  name: string,
  sortOrder: number,
): CircleSummary {
  return {
    id,
    name,
    color: "#6B8A6E",
    icon: "users",
    followUpDays: 30,
    sortOrder,
    isDefault: false,
    googleSyncEnabled: false,
    googleSyncedAt: null,
    googleSyncError: null,
  };
}
