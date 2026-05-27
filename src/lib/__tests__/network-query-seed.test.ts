import { describe, it, expect } from "vitest";
import { buildSeedMessages } from "@/lib/intelligence/network-query";

describe("buildSeedMessages (M0.x.11)", () => {
  it("returns single-turn messages for a top-level query", () => {
    const out = buildSeedMessages("Who works at Anthropic?");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      role: "user",
      content: "Who works at Anthropic?",
    });
  });

  it("returns three-turn conversation when priorContext is set", () => {
    const out = buildSeedMessages("Only those still there in 2026?", {
      question: "Who has worked at Anthropic?",
      answer: "Sarah, David, and Marcus all spent time there.",
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      role: "user",
      content: "Who has worked at Anthropic?",
    });
    expect(out[1]).toEqual({
      role: "assistant",
      content: "Sarah, David, and Marcus all spent time there.",
    });
    expect(out[2]).toEqual({
      role: "user",
      content: "Only those still there in 2026?",
    });
  });

  it("preserves message order (parent first, then refinement)", () => {
    const out = buildSeedMessages("follow-up", {
      question: "original",
      answer: "original-answer",
    });
    const roles = out.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user"]);
  });

  it("treats explicit undefined priorContext the same as omitted", () => {
    const out = buildSeedMessages("a query", undefined);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
  });
});
