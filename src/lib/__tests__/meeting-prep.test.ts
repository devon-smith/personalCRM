import { describe, expect, it } from "vitest";
import {
  selectMeetingPrepResearchContactIds,
  type MeetingPrepResearchCandidate,
} from "@/lib/meeting-prep";

function candidate(
  id: string,
  overrides: Partial<MeetingPrepResearchCandidate> = {},
): MeetingPrepResearchCandidate {
  return {
    id,
    tier: "PROFESSIONAL",
    email: `${id}@example.com`,
    role: null,
    company: null,
    lastInteraction: null,
    openAlexAuthorId: null,
    isNoise: false,
    ...overrides,
  };
}

describe("meeting prep public research selection", () => {
  it("caps scholarly and open-web research to the highest-signal attendees", () => {
    const selected = selectMeetingPrepResearchContactIds(
      [
        candidate("low-acquaintance", { tier: "ACQUAINTANCE" }),
        candidate("inner", { tier: "INNER_CIRCLE" }),
        candidate("pinned", { openAlexAuthorId: "https://openalex.org/A123" }),
        candidate("recent", { lastInteraction: new Date(Date.now() - 2 * 86_400_000) }),
        candidate("context", { role: "Dean", company: "Stanford" }),
      ],
      { scholarly: 3, openWeb: 2 },
    );

    expect(selected.scholarly).toEqual(["inner", "pinned", "recent"]);
    expect(selected.openWeb).toEqual(["inner", "pinned"]);
  });

  it("excludes noise contacts from public research", () => {
    const selected = selectMeetingPrepResearchContactIds(
      [
        candidate("noise", {
          tier: "INNER_CIRCLE",
          openAlexAuthorId: "https://openalex.org/A999",
          isNoise: true,
        }),
        candidate("person"),
      ],
      { scholarly: 5, openWeb: 5 },
    );

    expect(selected.scholarly).toEqual(["person"]);
    expect(selected.openWeb).toEqual(["person"]);
  });
});
