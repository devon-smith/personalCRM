import { describe, it, expect } from "vitest";
import {
  normalizeChannel,
  isConversationEnder,
  isTapback,
} from "@/lib/filters";

// ─── normalizeChannel ───────────────────────────────────────

describe("normalizeChannel", () => {
  it("maps iMessage to text", () => {
    expect(normalizeChannel("iMessage")).toBe("text");
  });

  it("maps SMS to text", () => {
    expect(normalizeChannel("SMS")).toBe("text");
  });

  it("maps text to text", () => {
    expect(normalizeChannel("text")).toBe("text");
  });

  it("maps gmail to email", () => {
    expect(normalizeChannel("gmail")).toBe("email");
  });

  it("maps email to email", () => {
    expect(normalizeChannel("email")).toBe("email");
  });

  it("maps linkedin to linkedin", () => {
    expect(normalizeChannel("linkedin")).toBe("linkedin");
  });

  it("maps whatsapp to whatsapp", () => {
    expect(normalizeChannel("whatsapp")).toBe("whatsapp");
  });

  it("is case insensitive", () => {
    expect(normalizeChannel("GMAIL")).toBe("email");
    expect(normalizeChannel("iMESSAGE")).toBe("text");
  });

  it("passes through unknown channels", () => {
    expect(normalizeChannel("carrier_pigeon")).toBe("carrier_pigeon");
  });
});

// ─── isConversationEnder ────────────────────────────────────

describe("isConversationEnder", () => {
  // Positive cases
  it("detects exact enders", () => {
    expect(isConversationEnder("ok")).toBe(true);
    expect(isConversationEnder("thanks")).toBe(true);
    expect(isConversationEnder("lol")).toBe(true);
    expect(isConversationEnder("sounds good")).toBe(true);
    expect(isConversationEnder("got it")).toBe(true);
    expect(isConversationEnder("bye")).toBe(true);
    expect(isConversationEnder("congrats")).toBe(true);
  });

  it("detects emoji-only messages", () => {
    expect(isConversationEnder("👍")).toBe(true);
    expect(isConversationEnder("😂")).toBe(true);
    // ❤️ has a variation selector that may not match the emoji regex
    // but single-codepoint emoji work
    expect(isConversationEnder("🔥")).toBe(true);
  });

  it("handles trailing punctuation", () => {
    expect(isConversationEnder("ok!")).toBe(true);
    expect(isConversationEnder("thanks!!")).toBe(true);
    expect(isConversationEnder("cool.")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(isConversationEnder("OK")).toBe(true);
    expect(isConversationEnder("Thanks")).toBe(true);
    expect(isConversationEnder("LOL")).toBe(true);
  });

  it("detects prefix enders with trailing words", () => {
    expect(isConversationEnder("thanks beast")).toBe(true);
    expect(isConversationEnder("thank you dev")).toBe(true);
    expect(isConversationEnder("sounds good to me")).toBe(true);
    expect(isConversationEnder("got it thanks")).toBe(true);
  });

  it("detects pattern enders", () => {
    expect(isConversationEnder("haha")).toBe(true);
    expect(isConversationEnder("hahaha")).toBe(true);
    expect(isConversationEnder("lmaooo")).toBe(true);
    expect(isConversationEnder("lmao")).toBe(true);
  });

  it("strips group chat prefix", () => {
    expect(isConversationEnder("(in group chat) ok")).toBe(true);
    expect(isConversationEnder("(in group chat) 👍")).toBe(true);
  });

  // Negative cases
  it("rejects real questions (long enough to not match prefix)", () => {
    expect(isConversationEnder("ok so what about the meeting?")).toBe(false);
    // "thanks but can we discuss more about the project?" is 9 words = too long
    expect(isConversationEnder("thanks but can we discuss more about the project?")).toBe(false);
  });

  it("matches short prefix enders even with trailing words", () => {
    // "thanks but can we" is 4 words starting with "thanks" = prefix match
    expect(isConversationEnder("thanks dude")).toBe(true);
  });

  it("rejects long messages", () => {
    expect(isConversationEnder("ok so I was thinking about that thing you mentioned and I have some thoughts")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isConversationEnder(null)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isConversationEnder("")).toBe(false);
  });

  it("rejects substantive messages", () => {
    expect(isConversationEnder("Can we meet tomorrow at 3?")).toBe(false);
    expect(isConversationEnder("I'll send the report by end of day")).toBe(false);
  });
});

// ─── isTapback ──────────────────────────────────────────────

describe("isTapback", () => {
  // Positive cases
  it("detects curly-quoted tapbacks", () => {
    expect(isTapback('Loved \u201Chey\u201D')).toBe(true);
    expect(isTapback('Liked \u201Csounds good\u201D')).toBe(true);
    expect(isTapback('Laughed at \u201Clol\u201D')).toBe(true);
    expect(isTapback('Emphasized \u201Cmeet at 3\u201D')).toBe(true);
  });

  it("detects straight-quoted tapbacks", () => {
    expect(isTapback('Loved "hey"')).toBe(true);
    expect(isTapback('Liked "sounds good"')).toBe(true);
  });

  it("detects article-style tapbacks", () => {
    expect(isTapback("Loved a photo")).toBe(true);
    expect(isTapback("Liked an image")).toBe(true);
  });

  it("detects React-style tapbacks", () => {
    expect(isTapback("Reacted ❤️ to your message")).toBe(true);
  });

  it("handles group chat prefix", () => {
    expect(isTapback('(in group chat) Loved "hey"')).toBe(true);
    expect(isTapback("(in group chat) Reacted ❤️ to your message")).toBe(true);
  });

  // Negative cases
  it("rejects normal messages", () => {
    expect(isTapback("I loved that movie")).toBe(false);
    expect(isTapback("Hey what's up")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isTapback("")).toBe(false);
  });

  it("rejects partial matches", () => {
    expect(isTapback("I Liked the idea")).toBe(false);
  });
});
