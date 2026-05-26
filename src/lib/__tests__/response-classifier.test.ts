import { describe, it, expect } from "vitest";
import {
  parseClassifyResponse,
  buildUserPrompt,
} from "@/lib/inbox/response-classifier";

describe("parseClassifyResponse", () => {
  it("parses a needsResponse=true classification", () => {
    const out = parseClassifyResponse(
      '{"needsResponse": true, "confidence": 0.92, "reason": "Asks a direct question", "category": "question"}',
    );
    expect(out.needsResponse).toBe(true);
    expect(out.confidence).toBeCloseTo(0.92);
    expect(out.reason).toBe("Asks a direct question");
    expect(out.category).toBe("question");
  });

  it("parses a needsResponse=false classification", () => {
    const out = parseClassifyResponse(
      '{"needsResponse": false, "confidence": 0.85, "reason": "Brief thanks", "category": "thanks"}',
    );
    expect(out.needsResponse).toBe(false);
    expect(out.category).toBe("thanks");
  });

  it("clamps confidence to [0, 1]", () => {
    const tooHigh = parseClassifyResponse(
      '{"needsResponse": true, "confidence": 1.5, "reason": "x", "category": "question"}',
    );
    expect(tooHigh.confidence).toBe(1.0);
    const tooLow = parseClassifyResponse(
      '{"needsResponse": true, "confidence": -0.3, "reason": "x", "category": "question"}',
    );
    expect(tooLow.confidence).toBe(0.0);
  });

  it("falls back to a sensible category when missing/unknown", () => {
    const trueResult = parseClassifyResponse(
      '{"needsResponse": true, "confidence": 0.5, "reason": "x", "category": "bogus"}',
    );
    expect(trueResult.category).toBe("question");
    const falseResult = parseClassifyResponse(
      '{"needsResponse": false, "confidence": 0.5, "reason": "x", "category": "bogus"}',
    );
    expect(falseResult.category).toBe("fyi");
  });

  it("tolerates surrounding text and only picks the JSON object", () => {
    const out = parseClassifyResponse(
      'Sure! Here it is: {"needsResponse": true, "confidence": 0.7, "reason": "Direct question", "category": "question"} hope that helps.',
    );
    expect(out.needsResponse).toBe(true);
    expect(out.reason).toBe("Direct question");
  });

  it("fail-opens to needsResponse=true on parse error", () => {
    const out = parseClassifyResponse("not even close to JSON");
    expect(out.needsResponse).toBe(true);
    expect(out.confidence).toBe(0);
    expect(out.category).toBe("question");
  });

  it("fail-opens when needsResponse is missing", () => {
    const out = parseClassifyResponse(
      '{"confidence": 0.5, "reason": "x", "category": "question"}',
    );
    expect(out.needsResponse).toBe(true);
    expect(out.confidence).toBe(0);
  });

  it("provides a default reason when the model omits one", () => {
    const out = parseClassifyResponse(
      '{"needsResponse": true, "confidence": 0.7, "category": "question"}',
    );
    expect(out.reason.length).toBeGreaterThan(0);
  });
});

describe("buildUserPrompt", () => {
  it("includes subject, relationship, and message", () => {
    const out = buildUserPrompt({
      messageBody: "Could we meet next Tuesday at 3pm?",
      subject: "Re: Sabbatical timing",
      relationshipType: "former_student",
    });
    expect(out).toContain("former_student");
    expect(out).toContain("Sabbatical timing");
    expect(out).toContain("Could we meet next Tuesday at 3pm?");
    // Re:/Fwd: prefixes stripped from the subject.
    expect(out).not.toMatch(/^\s*Subject: Re:/m);
  });

  it("includes thread context when provided", () => {
    const out = buildUserPrompt({
      messageBody: "Sounds good!",
      threadContext: [
        { role: "outbound", text: "Are you in town next week?" },
        { role: "inbound", text: "Yes — Tuesday works." },
      ],
    });
    expect(out).toContain("Me: Are you in town next week?");
    expect(out).toContain("Them: Yes — Tuesday works.");
  });

  it("works with just a body", () => {
    const out = buildUserPrompt({
      messageBody: "Thanks!",
    });
    expect(out).toContain("Thanks!");
    expect(out).not.toContain("Sender relationship:");
  });

  it("truncates very long bodies", () => {
    const huge = "x".repeat(10000);
    const out = buildUserPrompt({ messageBody: huge });
    expect(out.length).toBeLessThan(huge.length);
    expect(out).toContain("…");
  });
});
