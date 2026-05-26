import { describe, it, expect } from "vitest";
import {
  buildExtractionPrompt,
  parseExtractionResponse,
  type ExtractAttributesInput,
} from "@/lib/intelligence/extract-attributes";

function mkInput(): ExtractAttributesInput {
  return {
    contact: {
      name: "Marc Beban",
      email: "marc@example.com",
      company: "Acme Corp",
      role: "Founder",
      city: "San Francisco",
      state: "CA",
      country: "USA",
      notes: "Met at GSB 2022 panel; bright kid, very curious",
      howWeMet: "Stanford GSB MSx program",
      lastSeenScholarlyInstitution: null,
      circles: ["MSx 2022", "Bay Area"],
    },
    interactions: [
      {
        type: "email",
        direction: "INBOUND",
        subject: "Quick question on the deck",
        summary: "Asked about section 3 framing",
        occurredAt: new Date("2026-05-20"),
      },
    ],
    journalEntries: [
      {
        content: "Great catch-up call. Excited about his new fund.",
        mood: "energized",
        createdAt: new Date("2026-05-15"),
      },
    ],
  };
}

describe("buildExtractionPrompt", () => {
  it("includes the contact's core attributes", () => {
    const prompt = buildExtractionPrompt(mkInput());
    expect(prompt).toContain("Marc Beban");
    expect(prompt).toContain("marc@example.com");
    expect(prompt).toContain("Founder at Acme Corp");
    expect(prompt).toContain("San Francisco, CA, USA");
    expect(prompt).toContain("MSx 2022");
  });

  it("formats interactions with ISO dates + type + direction", () => {
    const prompt = buildExtractionPrompt(mkInput());
    expect(prompt).toMatch(/2026-05-20 email \(INBOUND\)/);
    expect(prompt).toContain('"Quick question on the deck"');
    expect(prompt).toContain("Asked about section 3 framing");
  });

  it("includes journal notes with mood", () => {
    const prompt = buildExtractionPrompt(mkInput());
    expect(prompt).toContain("[energized]");
    expect(prompt).toContain("Excited about his new fund");
  });

  it("omits sections when there's no data", () => {
    const minimal = {
      contact: {
        name: "Jane Doe",
        email: null,
        company: null,
        role: null,
        city: null,
        state: null,
        country: null,
        notes: null,
        howWeMet: null,
        lastSeenScholarlyInstitution: null,
        circles: [],
      },
      interactions: [],
      journalEntries: [],
    };
    const prompt = buildExtractionPrompt(minimal);
    expect(prompt).toContain("Jane Doe");
    expect(prompt).not.toContain("Recent interactions");
    expect(prompt).not.toContain("journal notes");
    expect(prompt).not.toContain("Email:");
    expect(prompt).not.toContain("Circles:");
  });

  it("truncates long journal entries to 300 chars", () => {
    const long = "x".repeat(500);
    const input: ExtractAttributesInput = {
      ...mkInput(),
      journalEntries: [
        { content: long, mood: null, createdAt: new Date("2026-05-01") },
      ],
    };
    const prompt = buildExtractionPrompt(input);
    // 300 x's, not 500.
    expect(prompt).toContain("x".repeat(300));
    expect(prompt).not.toContain("x".repeat(301));
  });
});

describe("parseExtractionResponse", () => {
  it("parses a well-formed JSON response", () => {
    const json = JSON.stringify({
      expertiseAreas: ["behavioral economics", "venture capital"],
      communicationStyle: {
        formality: "warm",
        responseSpeed: "fast",
        length: "moderate",
      },
      geographicContext: {
        primaryLocation: "San Francisco, CA",
        travelFrequency: "medium",
      },
      personalitySignals: {
        humor: "dry",
        warmth: "high",
        interests: ["mountain biking", "wine"],
      },
      relationshipStage: "peer",
      rawAttributes: { hobby_intensity: "high" },
    });
    const out = parseExtractionResponse(json);
    expect(out).not.toBeNull();
    expect(out?.expertiseAreas).toEqual([
      "behavioral economics",
      "venture capital",
    ]);
    expect(out?.communicationStyle?.formality).toBe("warm");
    expect(out?.relationshipStage).toBe("peer");
    expect(out?.rawAttributes.hobby_intensity).toBe("high");
  });

  it("handles preamble + trailing prose around the JSON block", () => {
    const messy =
      "Here is the profile JSON for this contact:\n\n" +
      JSON.stringify({
        expertiseAreas: ["AI ethics"],
        communicationStyle: null,
        geographicContext: null,
        personalitySignals: null,
        relationshipStage: "mentor",
        rawAttributes: {},
      }) +
      "\n\nLet me know if you need more.";
    const out = parseExtractionResponse(messy);
    expect(out?.expertiseAreas).toEqual(["AI ethics"]);
    expect(out?.relationshipStage).toBe("mentor");
  });

  it("returns null on completely invalid input", () => {
    expect(parseExtractionResponse("not json at all")).toBeNull();
    expect(parseExtractionResponse("{ broken json")).toBeNull();
    expect(parseExtractionResponse("")).toBeNull();
  });

  it("normalizes unknown enum values to safe fallbacks", () => {
    const out = parseExtractionResponse(
      JSON.stringify({
        expertiseAreas: [],
        communicationStyle: {
          formality: "vibrant", // not a valid enum
          responseSpeed: "instant", // not valid
          length: "epic", // not valid
        },
        geographicContext: null,
        personalitySignals: null,
        relationshipStage: "nemesis", // not a stage
        rawAttributes: {},
      }),
    );
    expect(out?.communicationStyle?.formality).toBe("mixed");
    expect(out?.communicationStyle?.responseSpeed).toBe("unknown");
    expect(out?.communicationStyle?.length).toBe("mixed");
    expect(out?.relationshipStage).toBe("other");
  });

  it("caps expertiseAreas at 10 items", () => {
    const out = parseExtractionResponse(
      JSON.stringify({
        expertiseAreas: Array.from({ length: 20 }, (_, i) => `topic ${i}`),
        communicationStyle: null,
        geographicContext: null,
        personalitySignals: null,
        relationshipStage: null,
        rawAttributes: {},
      }),
    );
    expect(out?.expertiseAreas).toHaveLength(10);
  });

  it("filters non-string entries from string arrays", () => {
    const out = parseExtractionResponse(
      JSON.stringify({
        expertiseAreas: ["valid", 123, null, "another", { obj: true }],
        communicationStyle: null,
        geographicContext: null,
        personalitySignals: {
          humor: "dry",
          warmth: "high",
          interests: ["climbing", 42, "reading"],
        },
        geographicContextL: null,
        relationshipStage: null,
        rawAttributes: {},
      }),
    );
    expect(out?.expertiseAreas).toEqual(["valid", "another"]);
    expect(out?.personalitySignals?.interests).toEqual(["climbing", "reading"]);
  });

  it("handles null structured blocks without crashing", () => {
    const out = parseExtractionResponse(
      JSON.stringify({
        expertiseAreas: ["x"],
        communicationStyle: null,
        geographicContext: null,
        personalitySignals: null,
        relationshipStage: null,
        rawAttributes: null, // null instead of {}
      }),
    );
    expect(out).not.toBeNull();
    expect(out?.communicationStyle).toBeNull();
    expect(out?.rawAttributes).toEqual({});
  });
});
