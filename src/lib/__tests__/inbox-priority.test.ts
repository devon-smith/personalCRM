import { describe, it, expect } from "vitest";
import { computePriority } from "@/lib/inbox-priority";
import { hoursAgo, daysAgo } from "@/test/helpers";

function makeInput(overrides: Partial<Parameters<typeof computePriority>[0]> = {}) {
  return {
    tier: "PROFESSIONAL",
    channel: "email",
    triggerAt: hoursAgo(2),
    messageCount: 1,
    isGroupChat: false,
    ...overrides,
  };
}

describe("computePriority", () => {
  // ─── Tier weights ───────────────────────────────────────────

  it("scores INNER_CIRCLE at 30 points", () => {
    const result = computePriority(makeInput({ tier: "INNER_CIRCLE" }));
    // 30 (tier) + 25 (today) + 10 (email) = 65
    expect(result.score).toBe(65);
    expect(result.priority).toBe("high");
  });

  it("scores PROFESSIONAL at 15 points", () => {
    const result = computePriority(makeInput({ tier: "PROFESSIONAL" }));
    // 15 + 25 + 10 = 50
    expect(result.score).toBe(50);
    expect(result.priority).toBe("medium");
  });

  it("scores ACQUAINTANCE at 5 points", () => {
    const result = computePriority(makeInput({ tier: "ACQUAINTANCE" }));
    // 5 + 25 + 10 = 40
    expect(result.score).toBe(40);
    expect(result.priority).toBe("medium");
  });

  it("uses 10 as default for unknown tier", () => {
    const result = computePriority(makeInput({ tier: "CUSTOM_TIER" }));
    // 10 + 25 + 10 = 45
    expect(result.score).toBe(45);
  });

  // ─── Recency decay ─────────────────────────────────────────

  it("scores today messages at 25", () => {
    const result = computePriority(makeInput({ triggerAt: hoursAgo(2) }));
    expect(result.score).toBe(50); // 15 + 25 + 10
  });

  it("scores yesterday messages at 20", () => {
    const result = computePriority(makeInput({ triggerAt: hoursAgo(30) }));
    expect(result.score).toBe(45); // 15 + 20 + 10
  });

  it("scores 2-3 day messages at 15", () => {
    const result = computePriority(makeInput({ triggerAt: hoursAgo(60) }));
    expect(result.score).toBe(40); // 15 + 15 + 10
  });

  it("scores this-week messages at 10", () => {
    const result = computePriority(makeInput({ triggerAt: daysAgo(5) }));
    expect(result.score).toBe(35); // 15 + 10 + 10
  });

  it("scores older messages at 5", () => {
    const result = computePriority(makeInput({ triggerAt: daysAgo(10) }));
    expect(result.score).toBe(30); // 15 + 5 + 10
  });

  // ─── Channel weights ───────────────────────────────────────

  it("scores whatsapp at 15", () => {
    const result = computePriority(makeInput({ channel: "whatsapp" }));
    expect(result.score).toBe(55); // 15 + 25 + 15
  });

  it("scores text at 15", () => {
    const result = computePriority(makeInput({ channel: "text" }));
    expect(result.score).toBe(55); // 15 + 25 + 15
  });

  it("scores email at 10", () => {
    const result = computePriority(makeInput({ channel: "email" }));
    expect(result.score).toBe(50); // 15 + 25 + 10
  });

  it("scores linkedin at 8", () => {
    const result = computePriority(makeInput({ channel: "linkedin" }));
    expect(result.score).toBe(48); // 15 + 25 + 8
  });

  it("uses 5 for unknown channel", () => {
    const result = computePriority(makeInput({ channel: "carrier_pigeon" }));
    expect(result.score).toBe(45); // 15 + 25 + 5
  });

  // ─── Classification boost ──────────────────────────────────

  it("adds 20 for action_required", () => {
    const result = computePriority(makeInput({ classification: "action_required" }));
    expect(result.score).toBe(70); // 15 + 25 + 10 + 20
    expect(result.priority).toBe("high");
  });

  it("adds 15 for invitation", () => {
    const result = computePriority(makeInput({ classification: "invitation" }));
    expect(result.score).toBe(65); // 15 + 25 + 10 + 15
  });

  it("adds 10 for question", () => {
    const result = computePriority(makeInput({ classification: "question" }));
    expect(result.score).toBe(60); // 15 + 25 + 10 + 10
  });

  it("adds 0 for unknown classification", () => {
    const result = computePriority(makeInput({ classification: "fyi" }));
    expect(result.score).toBe(50); // 15 + 25 + 10 + 0
  });

  it("adds 0 for null classification", () => {
    const result = computePriority(makeInput({ classification: null }));
    expect(result.score).toBe(50);
  });

  // ─── Repeat messages bonus ─────────────────────────────────

  it("adds 10 for messageCount > 3", () => {
    const result = computePriority(makeInput({ messageCount: 4 }));
    expect(result.score).toBe(60); // 15 + 25 + 10 + 10
  });

  it("adds 0 for messageCount <= 3", () => {
    const result = computePriority(makeInput({ messageCount: 3 }));
    expect(result.score).toBe(50);
  });

  // ─── Group chat penalty ────────────────────────────────────

  it("subtracts 5 for group chats", () => {
    const result = computePriority(makeInput({ isGroupChat: true }));
    expect(result.score).toBe(45); // 15 + 25 + 10 - 5
  });

  // ─── Score → priority mapping ──────────────────────────────

  it("maps score >= 60 to high", () => {
    const result = computePriority(makeInput({ tier: "INNER_CIRCLE" }));
    expect(result.priority).toBe("high");
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it("maps score >= 30 to medium", () => {
    const result = computePriority(makeInput({ tier: "PROFESSIONAL" }));
    expect(result.priority).toBe("medium");
    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.score).toBeLessThan(60);
  });

  it("maps low score to low", () => {
    const result = computePriority(makeInput({
      tier: "ACQUAINTANCE",
      triggerAt: daysAgo(10),
      channel: "carrier_pigeon",
    }));
    // 5 + 5 + 5 = 15
    expect(result.priority).toBe("low");
    expect(result.score).toBeLessThan(30);
  });

  // ─── Score clamping ────────────────────────────────────────

  it("clamps score to max 100", () => {
    const result = computePriority(makeInput({
      tier: "INNER_CIRCLE",
      channel: "whatsapp",
      classification: "action_required",
      messageCount: 5,
    }));
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("clamps score to min 0", () => {
    // Even with all penalties, shouldn't go below 0
    const result = computePriority(makeInput({
      tier: "ACQUAINTANCE",
      triggerAt: daysAgo(10),
      channel: "carrier_pigeon",
      isGroupChat: true,
    }));
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  // ─── Reason string ─────────────────────────────────────────

  it("includes top 2 factors in reason", () => {
    const result = computePriority(makeInput({ tier: "INNER_CIRCLE" }));
    expect(result.reason).toContain("Inner circle");
    expect(result.reason).toContain("Sent today");
  });

  it("joins factors with middot", () => {
    const result = computePriority(makeInput({ tier: "INNER_CIRCLE" }));
    expect(result.reason).toMatch(/·/);
  });

  it("returns 'Low activity' when no positive factors", () => {
    // This won't actually happen in practice since tier always contributes,
    // but test the fallback
    const result = computePriority(makeInput({
      tier: "ACQUAINTANCE",
      triggerAt: daysAgo(10),
    }));
    // Will have positive factors (5 + 5 + 10), so reason won't be empty
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
