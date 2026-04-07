import { describe, it, expect } from "vitest";
import "@/test/helpers"; // mock prisma
import { scoreReplyPriority, isNoiseEmail } from "@/lib/thread-intelligence";

// ─── isNoiseEmail ───────────────────────────────────────────

describe("isNoiseEmail", () => {
  it("detects newsletters by subject", () => {
    expect(isNoiseEmail("Weekly Newsletter", null)).toBe(true);
    expect(isNoiseEmail("Your Daily Digest", null)).toBe(true);
  });

  it("detects auto-replies by subject", () => {
    expect(isNoiseEmail("Out of Office", null)).toBe(true);
    expect(isNoiseEmail("Re: Auto-Reply", null)).toBe(true);
    expect(isNoiseEmail("Automatic Reply: Meeting", null)).toBe(true);
  });

  it("detects calendar invites by subject", () => {
    expect(isNoiseEmail("Invitation: Team standup", null)).toBe(true);
    expect(isNoiseEmail("Accepted: Lunch with Jane", null)).toBe(true);
    expect(isNoiseEmail("Declined: Budget review", null)).toBe(true);
  });

  it("detects forwarded emails by subject", () => {
    expect(isNoiseEmail("Fwd: Check this out", null)).toBe(true);
    expect(isNoiseEmail("FW: Important doc", null)).toBe(true);
  });

  it("detects receipts and confirmations", () => {
    expect(isNoiseEmail("Order Confirmation #12345", null)).toBe(true);
    expect(isNoiseEmail("Your Receipt from Acme", null)).toBe(true);
    expect(isNoiseEmail("Invoice #456", null)).toBe(true);
  });

  it("detects verification emails", () => {
    expect(isNoiseEmail("Verify your email address", null)).toBe(true);
    expect(isNoiseEmail("Password Reset Request", null)).toBe(true);
  });

  it("detects automated body patterns (2+ signals)", () => {
    expect(isNoiseEmail(null, "This is an automated message. Please do not reply to this email.")).toBe(true);
    expect(isNoiseEmail(null, "You are receiving this because you signed up. Manage your preferences here.")).toBe(true);
  });

  it("does NOT flag single body signal", () => {
    // Just one pattern match in body is not enough
    expect(isNoiseEmail(null, "Click here to unsubscribe")).toBe(false);
  });

  it("does NOT flag real emails", () => {
    expect(isNoiseEmail("Re: Project update", "Hey, can we sync on this?")).toBe(false);
    expect(isNoiseEmail("Lunch tomorrow?", "Are you free at noon?")).toBe(false);
    expect(isNoiseEmail("Quick question", null)).toBe(false);
  });

  it("handles null subject and body", () => {
    expect(isNoiseEmail(null, null)).toBe(false);
  });
});

// ─── scoreReplyPriority ─────────────────────────────────────

describe("scoreReplyPriority", () => {
  it("returns skip for noise emails", () => {
    const result = scoreReplyPriority("Weekly Newsletter", null, 3, 1, null);
    expect(result.priority).toBe("skip");
    expect(result.reason).toBe("Automated or newsletter");
  });

  it("returns skip for calendar invites", () => {
    const result = scoreReplyPriority("Invitation: Team standup", null, 1, 1, null);
    expect(result.priority).toBe("skip");
  });

  it("returns skip for auto-replies", () => {
    const result = scoreReplyPriority("Out of Office", "I am currently away", 2, 1, null);
    expect(result.priority).toBe("skip");
  });

  it("scores high for urgent inner circle with question", () => {
    const result = scoreReplyPriority(
      "Re: Can we discuss this?",
      "Can you review the contract and let me know?",
      8, // 8 days waiting
      4, // 4 messages deep
      "INNER_CIRCLE",
    );
    expect(result.priority).toBe("high");
  });

  it("scores medium for professional contact waiting 3 days", () => {
    const result = scoreReplyPriority(
      "Re: Follow up",
      "Just checking in",
      3,
      2,
      "PROFESSIONAL",
    );
    expect(["medium", "high"]).toContain(result.priority);
  });

  it("scores higher for questions in subject", () => {
    const withQ = scoreReplyPriority("Meeting tomorrow?", null, 1, 1, null);
    const withoutQ = scoreReplyPriority("Meeting tomorrow", null, 1, 1, null);
    // Question adds +2 to score
    expect(withQ.priority === "high" || withQ.priority === "medium").toBe(true);
    // Both should at least be low
    expect(withoutQ.priority !== "skip").toBe(true);
  });

  it("scores higher for urgent language", () => {
    const result = scoreReplyPriority(
      "Urgent: Need approval ASAP",
      "This is time sensitive, deadline is tomorrow",
      1,
      1,
      null,
    );
    expect(result.reason).toContain("Time-sensitive");
  });

  it("scores higher for action requests", () => {
    const result = scoreReplyPriority(
      "Re: Report",
      "Can you send me the latest numbers?",
      2,
      2,
      null,
    );
    // Should detect "can you" + "send me"
    expect(result.priority !== "skip").toBe(true);
  });

  it("scores higher for deep threads", () => {
    const shallow = scoreReplyPriority("Hi", "Hello", 1, 1, null);
    const deep = scoreReplyPriority("Hi", "Hello", 1, 4, null);
    // Deep thread adds points
    expect(deep.reason).toContain("Active thread");
  });

  it("scores higher for longer wait times", () => {
    const recent = scoreReplyPriority("Hey", "What's up", 0, 1, null);
    const old = scoreReplyPriority("Hey", "What's up", 8, 1, null);
    expect(old.reason).toContain("waiting");
  });

  it("returns low priority for basic emails with no urgency", () => {
    const result = scoreReplyPriority(
      "Hi",
      "Hope you're well",
      0,
      1,
      "ACQUAINTANCE",
    );
    expect(result.priority).toBe("low");
  });

  it("includes reason string for high priority", () => {
    const result = scoreReplyPriority(
      "Urgent question?",
      "Please let me know ASAP",
      7,
      3,
      "INNER_CIRCLE",
    );
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.priority).toBe("high");
  });
});
