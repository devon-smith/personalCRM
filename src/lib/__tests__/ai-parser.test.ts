import { describe, expect, it } from "vitest";
import {
  MAX_INTERACTION_PARSE_INPUT_CHARS,
  coerceParsedInteraction,
  normalizeInteractionParseInput,
} from "@/lib/ai-parser";

describe("normalizeInteractionParseInput", () => {
  it("trims and caps pasted text", () => {
    const raw = `  ${"x".repeat(MAX_INTERACTION_PARSE_INPUT_CHARS + 20)}  `;
    const normalized = normalizeInteractionParseInput(raw);
    expect(normalized).toHaveLength(MAX_INTERACTION_PARSE_INPUT_CHARS);
    expect(normalized.startsWith("x")).toBe(true);
  });
});

describe("coerceParsedInteraction", () => {
  it("keeps valid model output and trims long subjects", () => {
    const parsed = coerceParsedInteraction(
      {
        type: "EMAIL",
        direction: "OUTBOUND",
        subject: "A".repeat(100),
        summary: " Followed up about the grant. ",
        occurredAt: "2026-06-29T12:00:00Z",
      },
      "fallback",
    );

    expect(parsed.type).toBe("EMAIL");
    expect(parsed.direction).toBe("OUTBOUND");
    expect(parsed.subject).toHaveLength(60);
    expect(parsed.summary).toBe("Followed up about the grant.");
    expect(parsed.occurredAt).toBe("2026-06-29T12:00:00Z");
  });

  it("falls back on invalid model output", () => {
    const parsed = coerceParsedInteraction(
      {
        type: "INVALID",
        direction: "SIDEWAYS",
        subject: "",
        summary: "",
        occurredAt: null,
      },
      "Fallback summary text",
    );

    expect(parsed).toEqual({
      type: "NOTE",
      direction: "INBOUND",
      subject: "Parsed interaction",
      summary: "Fallback summary text",
      occurredAt: null,
    });
  });
});
