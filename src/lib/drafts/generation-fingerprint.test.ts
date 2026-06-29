import { describe, expect, it } from "vitest";
import { buildDraftGenerationFingerprint } from "./generation-fingerprint";

describe("buildDraftGenerationFingerprint", () => {
  it("normalizes whitespace for stable duplicate detection", () => {
    const first = buildDraftGenerationFingerprint({
      surface: "composer",
      contactId: "contact-1",
      tone: "warm",
      context: "ask",
      contextDetail: "  Please introduce me to   Sam. ",
      variant: "detailed",
    });

    const second = buildDraftGenerationFingerprint({
      surface: "composer",
      contactId: "contact-1",
      tone: "warm",
      context: "ask",
      contextDetail: "Please introduce me to Sam.",
      variant: "detailed",
    });

    expect(second).toBe(first);
  });

  it("separates composer and workspace requests", () => {
    const base = {
      contactId: "contact-1",
      tone: "warm",
      context: "catching_up",
    };

    expect(
      buildDraftGenerationFingerprint({ ...base, surface: "composer" }),
    ).not.toBe(
      buildDraftGenerationFingerprint({ ...base, surface: "workspace" }),
    );
  });
});
