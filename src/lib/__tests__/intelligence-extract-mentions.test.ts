import { describe, it, expect } from "vitest";
import {
  parseMentionsResponse,
  matchNameToContact,
} from "@/lib/intelligence/extract-mentions";

describe("parseMentionsResponse", () => {
  it("parses a well-formed JSON response", () => {
    const out = parseMentionsResponse(
      JSON.stringify({ names: ["Marc Beban", "Sarah Chen"] }),
    );
    expect(out?.names).toEqual(["Marc Beban", "Sarah Chen"]);
  });

  it("handles preamble + trailing prose", () => {
    const out = parseMentionsResponse(
      'Here are the names I found:\n{"names": ["David Lerman"]}\nLet me know if more needed.',
    );
    expect(out?.names).toEqual(["David Lerman"]);
  });

  it("returns null on malformed input", () => {
    expect(parseMentionsResponse("not json")).toBeNull();
    expect(parseMentionsResponse("{ broken")).toBeNull();
  });

  it("returns empty names when no people mentioned", () => {
    const out = parseMentionsResponse(JSON.stringify({ names: [] }));
    expect(out?.names).toEqual([]);
  });

  it("filters non-string entries + trims whitespace", () => {
    const out = parseMentionsResponse(
      JSON.stringify({
        names: ["  Marc Beban  ", 42, null, "Sarah", "", { obj: true }],
      }),
    );
    expect(out?.names).toEqual(["Marc Beban", "Sarah"]);
  });

  it("caps at 20 entries", () => {
    const out = parseMentionsResponse(
      JSON.stringify({
        names: Array.from({ length: 30 }, (_, i) => `Person ${i}`),
      }),
    );
    expect(out?.names).toHaveLength(20);
  });

  it("filters names shorter than 2 chars", () => {
    const out = parseMentionsResponse(
      JSON.stringify({ names: ["a", "J", "Jo", "Marc"] }),
    );
    expect(out?.names).toEqual(["Jo", "Marc"]);
  });
});

describe("matchNameToContact", () => {
  const contacts = [
    { id: "c1", name: "Marc Beban" },
    { id: "c2", name: "Sarah Chen" },
    { id: "c3", name: "Marcus Aurelius" },
    { id: "c4", name: "David Lerman" },
    { id: "c5", name: "David Park" },
  ];

  it("matches exact case-insensitive full names", () => {
    expect(matchNameToContact("Marc Beban", contacts)).toBe("c1");
    expect(matchNameToContact("MARC BEBAN", contacts)).toBe("c1");
    expect(matchNameToContact("sarah chen", contacts)).toBe("c2");
  });

  it("matches multi-token names where all tokens appear in contact", () => {
    // "Marc B." → only "Marc Beban" contains both "marc" and "b"
    // (substring match works). Actually "marc" + "b" both appear in
    // "marc beban" — yes. And in "marcus aurelius"? "marc" yes,
    // "b" no. So unique → match.
    expect(matchNameToContact("Marc B", contacts)).toBe("c1");
  });

  it("matches single first-name when exactly one contact has it", () => {
    expect(matchNameToContact("Sarah", contacts)).toBe("c2");
    expect(matchNameToContact("Marcus", contacts)).toBe("c3");
  });

  it("returns null on ambiguous first-name (multiple contacts)", () => {
    // Both David Lerman + David Park start with "David".
    expect(matchNameToContact("David", contacts)).toBeNull();
  });

  it("returns null when no match found", () => {
    expect(matchNameToContact("Unknown Person", contacts)).toBeNull();
    expect(matchNameToContact("Xyz", contacts)).toBeNull();
  });

  it("returns null on empty / whitespace", () => {
    expect(matchNameToContact("", contacts)).toBeNull();
    expect(matchNameToContact("  ", contacts)).toBeNull();
  });

  it("is case-insensitive throughout", () => {
    expect(matchNameToContact("sarah", contacts)).toBe("c2");
    expect(matchNameToContact("SARAH", contacts)).toBe("c2");
  });

  it("returns null for multi-token where multiple contacts match", () => {
    const dupes = [
      { id: "a", name: "John A Smith" },
      { id: "b", name: "John B Smith" },
    ];
    // Both contacts contain both "john" and "smith" — ambiguous.
    expect(matchNameToContact("John Smith", dupes)).toBeNull();
  });
});
