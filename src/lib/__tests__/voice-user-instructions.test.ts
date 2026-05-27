import { describe, it, expect } from "vitest";
import {
  buildVoiceBlock,
  buildInstructionsBlock,
  hasVoiceContext,
  type BuildVoicePromptParams,
} from "@/lib/voice/draft-prompt";

const BASE_PARAMS: BuildVoicePromptParams = {
  learnedProfile: null,
  examples: [],
  references: [],
  relationshipType: "former_student",
};

describe("buildInstructionsBlock (M0.x.12)", () => {
  it("renders the highest-priority framing", () => {
    const out = buildInstructionsBlock("Be warm but never use 'circle back'.");
    expect(out).toContain("CUSTOM VOICE INSTRUCTIONS");
    expect(out).toContain("highest priority");
    expect(out).toContain("override conflicting guidance");
    expect(out).toContain("Be warm but never use 'circle back'.");
  });
});

describe("hasVoiceContext (M0.x.12)", () => {
  it("returns true when only userInstructions are set", () => {
    expect(
      hasVoiceContext({
        ...BASE_PARAMS,
        userInstructions: "Never use exclamation points.",
      }),
    ).toBe(true);
  });

  it("returns false when userInstructions is empty/whitespace and no other voice context", () => {
    expect(
      hasVoiceContext({ ...BASE_PARAMS, userInstructions: "   " }),
    ).toBe(false);
    expect(
      hasVoiceContext({ ...BASE_PARAMS, userInstructions: "" }),
    ).toBe(false);
    expect(
      hasVoiceContext({ ...BASE_PARAMS, userInstructions: null }),
    ).toBe(false);
  });
});

describe("buildVoiceBlock + userInstructions (M0.x.12)", () => {
  it("places custom instructions FIRST, above references", () => {
    const ref = {
      id: "vref_a",
      filename: "kb.md",
      sourceType: "gpt_knowledge_base",
      content: "be warm",
      guidance: {
        greetings: ["Hey,"],
        closings: [],
        signaturePhrases: [],
        avoidPhrases: [],
        toneNotes: "Warm + dry humor.",
      },
    };
    const out =
      buildVoiceBlock({
        ...BASE_PARAMS,
        userInstructions: "Never use exclamation points.",
        references: [ref],
      }) ?? "";
    const instructionsIdx = out.indexOf("CUSTOM VOICE INSTRUCTIONS");
    const referencesIdx = out.indexOf("PRIMARY VOICE REFERENCES");
    expect(instructionsIdx).toBeGreaterThanOrEqual(0);
    expect(referencesIdx).toBeGreaterThan(instructionsIdx);
  });

  it("renders the user instruction text verbatim", () => {
    const out =
      buildVoiceBlock({
        ...BASE_PARAMS,
        userInstructions:
          "Be warm but direct. Never say 'just wanted to'.",
      }) ?? "";
    expect(out).toContain("Be warm but direct.");
    expect(out).toContain("Never say 'just wanted to'.");
  });

  it("trims whitespace-only instructions before deciding to render", () => {
    const out = buildVoiceBlock({
      ...BASE_PARAMS,
      userInstructions: "   \n   ",
    });
    // Whitespace-only is treated as no instructions; nothing else
    // provided either, so the whole block is null.
    expect(out).toBeNull();
  });

  it("renders alongside the learned profile + references properly ordered", () => {
    const out =
      buildVoiceBlock({
        userInstructions: "Always close with 'lovely to hear from you'.",
        learnedProfile: {
          byRelationship: {
            former_student: {
              count: 5,
              greetings: [],
              closings: [],
              avgSentenceLen: 12,
              wordCountMedian: 80,
              signaturePhrases: [],
            },
          } as unknown as never,
          neverSays: ["Hope this finds you well"],
          overallCount: 5,
          generatedAt: 0,
        },
        examples: [],
        references: [
          {
            id: "vref_a",
            filename: "kb.md",
            sourceType: "gpt_knowledge_base",
            content: "x",
            guidance: {
              greetings: [],
              closings: [],
              signaturePhrases: [],
              avoidPhrases: ["Per my last email"],
              toneNotes: "Warm",
            },
          },
        ],
        relationshipType: "former_student",
      }) ?? "";
    // Expected order: CUSTOM INSTRUCTIONS → PRIMARY VOICE REFERENCES
    // → "How the user typically writes..." → never-says block
    const idxInstr = out.indexOf("CUSTOM VOICE INSTRUCTIONS");
    const idxRef = out.indexOf("PRIMARY VOICE REFERENCES");
    const idxLearned = out.indexOf("How the user typically writes");
    const idxNever = out.indexOf("Phrases the user never uses");
    expect(idxInstr).toBeGreaterThanOrEqual(0);
    expect(idxRef).toBeGreaterThan(idxInstr);
    expect(idxLearned).toBeGreaterThan(idxRef);
    expect(idxNever).toBeGreaterThan(idxLearned);
  });
});
