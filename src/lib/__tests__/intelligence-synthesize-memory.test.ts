import { describe, it, expect } from "vitest";
import {
  buildSynthesisPrompt,
  parseSynthesisResponse,
  type SynthesizeMemoryInput,
} from "@/lib/intelligence/synthesize-memory";

function mkInput(): SynthesizeMemoryInput {
  return {
    contact: {
      name: "Marc Beban",
      company: "Acme Corp",
      role: "Founder",
      notes: null,
    },
    interactions: [
      {
        type: "email",
        direction: "INBOUND",
        subject: "Re: dinner Tuesday",
        summary: "Marc asked if his wife Jess can join",
        occurredAt: new Date("2026-05-20"),
      },
    ],
    journalEntries: [],
    priorMemory: null,
  };
}

describe("buildSynthesisPrompt", () => {
  it("includes contact, interactions, and signals first synthesis", () => {
    const prompt = buildSynthesisPrompt(mkInput());
    expect(prompt).toContain("Marc Beban");
    expect(prompt).toContain("Founder at Acme Corp");
    expect(prompt).toContain("first synthesis");
    expect(prompt).toContain('"Re: dinner Tuesday"');
    expect(prompt).toContain("Marc asked if his wife Jess");
  });

  it("includes prior memory as JSON context when present", () => {
    const input = mkInput();
    input.priorMemory = {
      discussedTopics: [
        { topic: "Q3 strategy", lastMentioned: "2026-04-01", frequency: "frequent" },
      ],
      theyMentioned: [],
      openThreads: [
        {
          subject: "intro to Sarah",
          raisedBy: "them",
          raisedAt: "2026-04-15",
          status: "open",
        },
      ],
      personalContext: { location: "SF" },
      recurringThemes: ["product strategy"],
    };
    const prompt = buildSynthesisPrompt(input);
    expect(prompt).toContain("Prior memory (your last synthesis)");
    expect(prompt).toContain("Q3 strategy");
    expect(prompt).toContain("intro to Sarah");
    expect(prompt).not.toContain("first synthesis");
  });

  it("truncates long journal entries to 400 chars", () => {
    const input = mkInput();
    input.journalEntries = [
      {
        content: "y".repeat(800),
        mood: null,
        createdAt: new Date("2026-05-01"),
      },
    ];
    const prompt = buildSynthesisPrompt(input);
    expect(prompt).toContain("y".repeat(400));
    expect(prompt).not.toContain("y".repeat(401));
  });

  it("omits journal section when empty", () => {
    const prompt = buildSynthesisPrompt(mkInput());
    expect(prompt).not.toContain("journal notes");
  });
});

describe("parseSynthesisResponse", () => {
  it("parses a complete well-formed JSON response", () => {
    const json = JSON.stringify({
      discussedTopics: [
        { topic: "dinner planning", lastMentioned: "2026-05-20", frequency: "occasional" },
      ],
      theyMentioned: [
        {
          subject: "wife Jess joining for dinner",
          context: "Mentioned in May 20 email",
          mentionedAt: "2026-05-20",
        },
      ],
      openThreads: [
        {
          subject: "respond about dinner",
          raisedBy: "them",
          raisedAt: "2026-05-20",
          status: "open",
        },
      ],
      personalContext: { family: "wife Jess", location: "SF" },
      recurringThemes: ["dinner planning", "family"],
    });
    const out = parseSynthesisResponse(json);
    expect(out).not.toBeNull();
    expect(out?.discussedTopics).toHaveLength(1);
    expect(out?.discussedTopics[0].topic).toBe("dinner planning");
    expect(out?.theyMentioned[0].subject).toContain("Jess");
    expect(out?.openThreads[0].status).toBe("open");
    expect(out?.personalContext.family).toBe("wife Jess");
    expect(out?.recurringThemes).toEqual(["dinner planning", "family"]);
  });

  it("handles preamble + trailing prose", () => {
    const messy =
      "Here's the updated memory:\n\n" +
      JSON.stringify({
        discussedTopics: [],
        theyMentioned: [],
        openThreads: [],
        personalContext: {},
        recurringThemes: ["AI ethics"],
      }) +
      "\n\n— end —";
    const out = parseSynthesisResponse(messy);
    expect(out?.recurringThemes).toEqual(["AI ethics"]);
  });

  it("returns null on completely malformed input", () => {
    expect(parseSynthesisResponse("not json")).toBeNull();
    expect(parseSynthesisResponse("{ broken")).toBeNull();
    expect(parseSynthesisResponse("")).toBeNull();
  });

  it("normalizes unknown enum values to safe fallbacks", () => {
    const out = parseSynthesisResponse(
      JSON.stringify({
        discussedTopics: [
          { topic: "x", lastMentioned: "2026-01-01", frequency: "constant" }, // not valid
        ],
        theyMentioned: [],
        openThreads: [
          {
            subject: "x",
            raisedBy: "robot", // not valid
            raisedAt: "2026-01-01",
            status: "in-progress", // not valid
          },
        ],
        personalContext: {},
        recurringThemes: [],
      }),
    );
    expect(out?.discussedTopics[0].frequency).toBe("occasional");
    expect(out?.openThreads[0].raisedBy).toBe("them");
    expect(out?.openThreads[0].status).toBe("open");
  });

  it("filters out entries missing required fields", () => {
    const out = parseSynthesisResponse(
      JSON.stringify({
        discussedTopics: [
          { topic: "valid", lastMentioned: "2026-01-01", frequency: "once" },
          { topic: "", lastMentioned: "2026-01-01", frequency: "once" }, // empty topic
          { lastMentioned: "2026-01-01" }, // no topic
          "not an object",
        ],
        theyMentioned: [
          { subject: "valid", context: "x", mentionedAt: "2026-01-01" },
          { context: "no subject", mentionedAt: "2026-01-01" },
        ],
        openThreads: [
          { subject: "valid", raisedBy: "user", raisedAt: "2026-01-01", status: "open" },
          { subject: "", raisedBy: "user", raisedAt: "2026-01-01", status: "open" },
        ],
        personalContext: {
          family: "wife Jess",
          empty: "", // dropped
          notString: 42, // dropped
        },
        recurringThemes: ["x", "", "y", null, "z"],
      }),
    );
    expect(out?.discussedTopics).toHaveLength(1);
    expect(out?.theyMentioned).toHaveLength(1);
    expect(out?.openThreads).toHaveLength(1);
    expect(Object.keys(out?.personalContext ?? {})).toEqual(["family"]);
    expect(out?.recurringThemes).toEqual(["x", "y", "z"]);
  });

  it("caps each array at sane size", () => {
    const out = parseSynthesisResponse(
      JSON.stringify({
        discussedTopics: Array.from({ length: 50 }, (_, i) => ({
          topic: `t${i}`,
          lastMentioned: "2026-01-01",
          frequency: "once",
        })),
        theyMentioned: [],
        openThreads: [],
        personalContext: {},
        recurringThemes: Array.from({ length: 20 }, (_, i) => `theme${i}`),
      }),
    );
    expect(out?.discussedTopics.length).toBeLessThanOrEqual(20);
    expect(out?.recurringThemes.length).toBeLessThanOrEqual(8);
  });
});
