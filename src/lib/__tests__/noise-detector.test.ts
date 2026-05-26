import { describe, it, expect } from "vitest";
import {
  classifyNoiseContact,
  isNoiseContact,
} from "@/lib/intelligence/noise-detector";

describe("isNoiseContact", () => {
  describe("system name phrases", () => {
    it.each([
      ["Settings", null],
      ["settings", null],
      ["SETTINGS", null],
      ["Helpful", null],
      ["Apple ID", null],
      ["LinkedIn", null],
      ["Stanford IT Help", null],
      ["No Reply", null],
    ])("flags system name %s", (name, email) => {
      expect(isNoiseContact({ name, email })).toBe(true);
    });

    it("does not flag a real name that contains a system word", () => {
      expect(isNoiseContact({ name: "Jennifer Settings", email: null })).toBe(false);
      expect(isNoiseContact({ name: "John Help", email: "john@example.com" })).toBe(
        false,
      );
    });
  });

  describe("automation email locals", () => {
    it.each([
      "noreply@stripe.com",
      "no-reply@example.com",
      "notifications@github.com",
      "support@example.com",
      "team@example.com",
      "help@example.com",
      "newsletter@example.com",
      "billing@example.com",
    ])("flags %s by local part", (email) => {
      expect(isNoiseContact({ name: "Anything", email })).toBe(true);
    });

    it("strips +tag before checking", () => {
      expect(
        isNoiseContact({ name: "Updates", email: "noreply+abc123@example.com" }),
      ).toBe(true);
    });

    it("does not flag a real local part with a system substring", () => {
      // "supporter" is not "support" — substring match would be wrong
      expect(
        isNoiseContact({ name: "Sam Helper", email: "supporter@example.com" }),
      ).toBe(false);
      expect(
        isNoiseContact({ name: "Mark Helps", email: "helpdesk@example.com" }),
      ).toBe(false);
    });
  });

  describe("automation domains", () => {
    it("flags linkedin notification domain", () => {
      expect(
        isNoiseContact({
          name: "Jennifer Aaker",
          email: "jenny@notify.linkedin.com",
        }),
      ).toBe(true);
    });

    it("does not flag personal gmail", () => {
      expect(
        isNoiseContact({ name: "Jane Doe", email: "jane@gmail.com" }),
      ).toBe(false);
    });
  });

  describe("classifyNoiseContact returns reasons", () => {
    it("returns empty reasons for real contact", () => {
      expect(
        classifyNoiseContact({ name: "Jane Doe", email: "jane@gmail.com" }),
      ).toEqual({ isNoise: false, reasons: [] });
    });

    it("returns multiple reasons when several rules fire", () => {
      const result = classifyNoiseContact({
        name: "LinkedIn",
        email: "noreply@notify.linkedin.com",
      });
      expect(result.isNoise).toBe(true);
      expect(result.reasons.length).toBeGreaterThanOrEqual(2);
      expect(result.reasons.some((r) => r.startsWith("name:"))).toBe(true);
      expect(result.reasons.some((r) => r.startsWith("email:"))).toBe(true);
    });

    it("handles null / undefined inputs gracefully", () => {
      expect(classifyNoiseContact({ name: null, email: null })).toEqual({
        isNoise: false,
        reasons: [],
      });
      expect(
        classifyNoiseContact({ name: undefined, email: undefined }),
      ).toEqual({ isNoise: false, reasons: [] });
    });

    it("handles malformed emails gracefully", () => {
      expect(
        classifyNoiseContact({ name: "Real Person", email: "not-an-email" }),
      ).toEqual({ isNoise: false, reasons: [] });
      expect(
        classifyNoiseContact({ name: "Real Person", email: "@no-local.com" }),
      ).toEqual({ isNoise: false, reasons: [] });
      expect(
        classifyNoiseContact({ name: "Real Person", email: "no-domain@" }),
      ).toEqual({ isNoise: false, reasons: [] });
    });
  });
});
