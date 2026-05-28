import { describe, it, expect } from "vitest";
import {
  parseFinalAnswer,
  NETWORK_QUERY_TOOL_COUNT,
} from "@/lib/intelligence/network-query";

describe("parseFinalAnswer", () => {
  it("parses well-formed JSON with all fields populated", () => {
    const text = JSON.stringify({
      title: "Dinner companions for Marcus",
      answer: "Based on shared interests + Bay Area presence, 3 people fit.",
      suggestions: [
        {
          contactId: "c1",
          name: "David Lerman",
          reason: "AI researcher who knows Marcus from 2023 conference",
        },
        {
          contactId: "c2",
          name: "Sarah Chen",
          reason: "Same MSx cohort, in SF now",
        },
      ],
    });
    const out = parseFinalAnswer(text);
    expect(out.title).toBe("Dinner companions for Marcus");
    expect(out.answer).toMatch(/Bay Area presence/);
    expect(out.suggestedContacts).toHaveLength(2);
    expect(out.suggestedContacts[0]).toEqual({
      contactId: "c1",
      name: "David Lerman",
      reason: "AI researcher who knows Marcus from 2023 conference",
    });
  });

  it("handles preamble + trailing prose around the JSON", () => {
    const messy =
      "Here's what I found:\n\n" +
      JSON.stringify({
        title: "Network search",
        answer: "Three matches.",
        suggestions: [{ contactId: "c1", name: "X", reason: "Y" }],
      }) +
      "\n\nLet me know if you want more.";
    const out = parseFinalAnswer(messy);
    expect(out.title).toBe("Network search");
    expect(out.suggestedContacts).toHaveLength(1);
  });

  it("falls back to using whole text as answer when JSON is malformed", () => {
    const text = "Sorry, I couldn't structure this properly { broken";
    const out = parseFinalAnswer(text);
    expect(out.title).toBeNull();
    expect(out.answer).toBe(text.trim());
    expect(out.suggestedContacts).toEqual([]);
  });

  it("returns empty suggestions when LLM acknowledges no good answer", () => {
    const text = JSON.stringify({
      title: null,
      answer: "I couldn't find anyone in your network matching that.",
      suggestions: [],
    });
    const out = parseFinalAnswer(text);
    expect(out.suggestedContacts).toEqual([]);
    expect(out.answer).toMatch(/couldn't find/);
  });

  it("filters out suggestion entries missing required fields", () => {
    const text = JSON.stringify({
      title: "x",
      answer: "y",
      suggestions: [
        { contactId: "c1", name: "Valid", reason: "OK" },
        { contactId: "", name: "Missing ID", reason: "x" },
        { contactId: "c3", name: "", reason: "Missing name" },
        { name: "No contactId field at all", reason: "x" },
        null,
        "not an object",
      ],
    });
    const out = parseFinalAnswer(text);
    expect(out.suggestedContacts).toHaveLength(1);
    expect(out.suggestedContacts[0].name).toBe("Valid");
  });

  it("handles non-string title/answer gracefully", () => {
    const text = JSON.stringify({
      title: 42, // wrong type
      answer: { not: "a string" },
      suggestions: [],
    });
    const out = parseFinalAnswer(text);
    expect(out.title).toBeNull();
    // Falls back to the full text when answer isn't a string.
    expect(out.answer.length).toBeGreaterThan(0);
  });

  it("handles missing suggestions array", () => {
    const text = JSON.stringify({
      title: "x",
      answer: "y",
      // no suggestions field
    });
    const out = parseFinalAnswer(text);
    expect(out.suggestedContacts).toEqual([]);
  });

  it("handles empty string", () => {
    const out = parseFinalAnswer("");
    expect(out.title).toBeNull();
    expect(out.answer).toBe("");
    expect(out.suggestedContacts).toEqual([]);
  });

  // ─── M0.x.15: empty-answer JSON fallback ──────────────────
  it("falls back to fallbackText when JSON answer is empty string", () => {
    const json = JSON.stringify({
      title: "Meeting attendees",
      answer: "",
      suggestions: [
        { contactId: "c1", name: "Jenni Aaker", reason: "Co-author on speech" },
      ],
    });
    const fallback =
      "Based on your close relationship with David Solomon, I recommend the people on his commencement-speech team.";
    const out = parseFinalAnswer(json, fallback);
    expect(out.title).toBe("Meeting attendees");
    expect(out.answer).toMatch(/close relationship with David/);
    expect(out.suggestedContacts).toHaveLength(1);
  });

  it("prefers JSON answer when present, ignoring fallbackText", () => {
    const json = JSON.stringify({
      title: "x",
      answer: "JSON answer wins",
      suggestions: [],
    });
    const fallback = "Ignored fallback prose";
    const out = parseFinalAnswer(json, fallback);
    expect(out.answer).toBe("JSON answer wins");
  });

  it("falls back to text-minus-JSON before reaching fallbackText", () => {
    // When Claude emits prose AND JSON in the final iteration but the
    // JSON has empty answer, we should grab the surrounding prose
    // before reaching fallbackText.
    const text =
      "Here's what I think: " +
      JSON.stringify({ title: "x", answer: "", suggestions: [] });
    const out = parseFinalAnswer(text, "Older accumulated prose");
    expect(out.answer).toBe("Here's what I think:");
  });

  it("uses fallbackText when malformed JSON AND text.trim is empty", () => {
    // Edge case: final iteration emits nothing but a {; fallback prose
    // from earlier iterations is the only signal. We want to PREFER
    // the older prose over an empty answer.
    const fallback = "Earlier prose explaining the answer.";
    const out = parseFinalAnswer("", fallback);
    expect(out.answer).toBe(fallback);
  });

  it("returns empty string when both text and fallback are empty (no crash)", () => {
    const out = parseFinalAnswer("", "");
    expect(out.answer).toBe("");
    expect(out.title).toBeNull();
    expect(out.suggestedContacts).toEqual([]);
  });
});

describe("tool registry", () => {
  it("registers all 9 tools (5 from M7.3 + 4 memory tools from M8.2)", () => {
    // If this number changes, double-check the system prompt still
    // describes the right tools to Claude.
    expect(NETWORK_QUERY_TOOL_COUNT).toBe(9);
  });
});
