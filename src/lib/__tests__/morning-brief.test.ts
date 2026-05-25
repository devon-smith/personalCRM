import { describe, it, expect } from "vitest";
import {
  renderBriefHtml,
  renderBriefText,
  buildBriefSubject,
  type MorningBriefData,
} from "@/lib/morning-brief";

function makeData(overrides: Partial<MorningBriefData> = {}): MorningBriefData {
  return {
    userId: "u1",
    userName: "Jennifer Aaker",
    userEmail: "jaaker@stanford.edu",
    forDate: "2026-05-25",
    forDatePretty: "Monday · May 25",
    appBaseUrl: "https://crm.example.com",
    priorities: [],
    meetings: [],
    moment: null,
    overnightSignals: [],
    ...overrides,
  };
}

describe("renderBriefHtml", () => {
  it("greets the user by first name", () => {
    const html = renderBriefHtml(makeData());
    expect(html).toContain("Good morning, Jennifer");
  });

  it("shows the date", () => {
    const html = renderBriefHtml(makeData());
    expect(html).toContain("Monday · May 25");
  });

  it("shows inbox-zero copy when there are no priorities", () => {
    const html = renderBriefHtml(makeData());
    expect(html).toContain("Inbox zero");
  });

  it("renders priority rows with name, reason, and inbox link", () => {
    const html = renderBriefHtml(
      makeData({
        priorities: [
          {
            id: "p1",
            contactName: "Marc Beban",
            company: "OpenEvidence",
            channel: "email",
            tier: "INNER_CIRCLE",
            priorityScore: 87,
            surfacedReason: "Inner circle · awaiting reply 2d",
            triggerAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            inboxUrl: "https://crm.example.com/dashboard?inboxItem=p1",
          },
        ],
      }),
    );
    expect(html).toContain("Marc Beban");
    expect(html).toContain("OpenEvidence");
    expect(html).toContain("Inner circle · awaiting reply 2d");
    expect(html).toContain("https://crm.example.com/dashboard?inboxItem=p1");
  });

  it("renders meeting rows with a prep link", () => {
    const html = renderBriefHtml(
      makeData({
        meetings: [
          {
            id: "evt1",
            title: "Office hours",
            startTime: new Date("2026-05-25T17:00:00Z").toISOString(),
            endTime: new Date("2026-05-25T18:00:00Z").toISOString(),
            attendees: [
              { name: "Ava Lin", email: "ava@stanford.edu", contactId: "c1" },
            ],
            prepUrl: "https://crm.example.com/meetings/evt1/prep",
            htmlLink: null,
          },
        ],
      }),
    );
    expect(html).toContain("Office hours");
    expect(html).toContain("Ava Lin");
    expect(html).toContain("/meetings/evt1/prep");
  });

  it("only includes the moment section when one is selected", () => {
    expect(renderBriefHtml(makeData())).not.toContain("Moment to connect");
    const html = renderBriefHtml(
      makeData({
        moment: {
          contactId: "c2",
          contactName: "Selina Tobaccowala",
          company: "Gixo",
          role: "Co-founder",
          tier: "INNER_CIRCLE",
          avatarUrl: null,
          daysSinceLastInteraction: 47,
          interactionCount: 12,
          reason: "47 days quiet · light day on the calendar",
          sourceSystem: "calendar",
          sourceRecordIds: ["calendar:freebusy:2026-05-25", "contact:c2"],
          occasion: "light_day",
          forDate: "2026-05-25",
        },
      }),
    );
    expect(html).toContain("Moment to connect");
    expect(html).toContain("Selina Tobaccowala");
    expect(html).toContain("47 days quiet");
  });

  it("only includes overnight signals when present", () => {
    expect(renderBriefHtml(makeData())).not.toContain("Overnight signals");
    const html = renderBriefHtml(
      makeData({
        overnightSignals: [
          {
            id: "s1",
            contactId: "c3",
            contactName: "Daniela Rus",
            detail: "Named to MIT CSAIL leadership",
            url: "https://example.com/article",
            detectedAt: new Date().toISOString(),
            contactUrl: "https://crm.example.com/people?contact=c3",
          },
        ],
      }),
    );
    expect(html).toContain("Overnight signals");
    expect(html).toContain("Daniela Rus");
    expect(html).toContain("MIT CSAIL");
  });

  it("escapes HTML in contact names to prevent injection", () => {
    const html = renderBriefHtml(
      makeData({
        priorities: [
          {
            id: "p1",
            contactName: '<script>alert("xss")</script>',
            company: null,
            channel: "email",
            tier: "INNER_CIRCLE",
            priorityScore: 50,
            surfacedReason: null,
            triggerAt: new Date().toISOString(),
            inboxUrl: "https://crm.example.com/dashboard?inboxItem=p1",
          },
        ],
      }),
    );
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderBriefText", () => {
  it("is mostly plain ASCII with section headers", () => {
    const text = renderBriefText(
      makeData({
        priorities: [
          {
            id: "p1",
            contactName: "Marc Beban",
            company: "OpenEvidence",
            channel: "email",
            tier: "INNER_CIRCLE",
            priorityScore: 87,
            surfacedReason: "Inner circle · awaiting reply 2d",
            triggerAt: new Date().toISOString(),
            inboxUrl: "https://crm.example.com/dashboard?inboxItem=p1",
          },
        ],
      }),
    );
    expect(text).toContain("AWAITING YOUR REPLY");
    expect(text).toContain("Marc Beban");
    expect(text).toContain("TODAY'S CALENDAR");
    expect(text).not.toContain("<");
  });
});

describe("buildBriefSubject", () => {
  it("summarizes counts in the subject", () => {
    const subj = buildBriefSubject(
      makeData({
        priorities: [
          {
            id: "p1",
            contactName: "x",
            company: null,
            channel: "email",
            tier: "INNER_CIRCLE",
            priorityScore: 50,
            surfacedReason: null,
            triggerAt: new Date().toISOString(),
            inboxUrl: "",
          },
        ],
        meetings: [
          {
            id: "e1",
            title: "x",
            startTime: new Date().toISOString(),
            endTime: null,
            attendees: [],
            prepUrl: "",
            htmlLink: null,
          },
          {
            id: "e2",
            title: "y",
            startTime: new Date().toISOString(),
            endTime: null,
            attendees: [],
            prepUrl: "",
            htmlLink: null,
          },
        ],
      }),
    );
    expect(subj).toContain("Monday · May 25");
    expect(subj).toContain("1 awaiting reply");
    expect(subj).toContain("2 meetings");
  });

  it("says 'all quiet' on an empty day", () => {
    expect(buildBriefSubject(makeData())).toContain("all quiet");
  });
});
