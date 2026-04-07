import { describe, it, expect } from "vitest";
import { normalizePhone, phonesMatch } from "@/lib/phone-match";

// ─── normalizePhone ─────────────────────────────────────────

describe("normalizePhone", () => {
  it("strips formatting and keeps last 10 digits", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("5551234567");
  });

  it("handles plain digits with country code", () => {
    expect(normalizePhone("15551234567")).toBe("5551234567");
  });

  it("handles 10-digit numbers", () => {
    expect(normalizePhone("5551234567")).toBe("5551234567");
  });

  it("handles international numbers (keeps last 10)", () => {
    expect(normalizePhone("+44 7911 123456")).toBe("7911123456");
  });

  it("handles numbers with dots", () => {
    expect(normalizePhone("555.123.4567")).toBe("5551234567");
  });

  it("handles numbers with spaces only", () => {
    expect(normalizePhone("555 123 4567")).toBe("5551234567");
  });

  it("handles short numbers (returns all digits)", () => {
    expect(normalizePhone("12345")).toBe("12345");
  });

  it("handles empty string", () => {
    expect(normalizePhone("")).toBe("");
  });

  it("strips letters", () => {
    expect(normalizePhone("555-ABC-4567")).toBe("5554567");
  });

  it("handles plus-only international format", () => {
    expect(normalizePhone("+15551234567")).toBe("5551234567");
  });
});

// ─── phonesMatch ────────────────────────────────────────────

describe("phonesMatch", () => {
  it("matches same number in different formats", () => {
    expect(phonesMatch("+1 (555) 123-4567", "5551234567")).toBe(true);
  });

  it("matches with and without country code", () => {
    expect(phonesMatch("+15551234567", "5551234567")).toBe(true);
  });

  it("rejects different numbers", () => {
    expect(phonesMatch("+15551234567", "+15559876543")).toBe(false);
  });

  it("matches international numbers by last 10 digits", () => {
    expect(phonesMatch("+447911123456", "7911123456")).toBe(true);
  });

  it("handles edge case of very short numbers", () => {
    // Both normalize to the same short string
    expect(phonesMatch("123", "123")).toBe(true);
    expect(phonesMatch("123", "456")).toBe(false);
  });
});
