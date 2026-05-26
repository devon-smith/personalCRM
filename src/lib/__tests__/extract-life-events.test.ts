import { describe, it, expect } from "vitest";
import {
  parseExtractResponse,
  buildUserPrompt,
} from "@/lib/feed/extract-life-events";

describe("parseExtractResponse", () => {
  it("parses a positive detection", () => {
    const out = parseExtractResponse(
      '{"hasEvent": true, "eventType": "new_role", "summary": "Starting at Anthropic next month"}',
    );
    expect(out.hasEvent).toBe(true);
    expect(out.eventType).toBe("new_role");
    expect(out.summary).toBe("Starting at Anthropic next month");
  });

  it("returns hasEvent=false for negative detection", () => {
    const out = parseExtractResponse(
      '{"hasEvent": false, "reason": "no announcement"}',
    );
    expect(out.hasEvent).toBe(false);
  });

  it("falls back to 'other' for unknown eventType", () => {
    const out = parseExtractResponse(
      '{"hasEvent": true, "eventType": "bogus", "summary": "Got a dog"}',
    );
    expect(out.eventType).toBe("other");
  });

  it("rejects positive detection without a summary", () => {
    const out = parseExtractResponse(
      '{"hasEvent": true, "eventType": "new_role"}',
    );
    // Treated as no-event since we can't render anything.
    expect(out.hasEvent).toBe(false);
  });

  it("tolerates leading/trailing prose", () => {
    const out = parseExtractResponse(
      'Sure — {"hasEvent": true, "eventType": "family", "summary": "Had a baby"} — that\'s the call.',
    );
    expect(out.hasEvent).toBe(true);
    expect(out.summary).toBe("Had a baby");
  });

  it("fails closed on malformed JSON", () => {
    const out = parseExtractResponse("absolute garbage with no json");
    expect(out.hasEvent).toBe(false);
  });

  it("trims whitespace from the summary", () => {
    const out = parseExtractResponse(
      '{"hasEvent": true, "eventType": "milestone", "summary": "  Got a MacArthur  "}',
    );
    expect(out.summary).toBe("Got a MacArthur");
  });
});

describe("buildUserPrompt", () => {
  it("includes sender, subject, and body", () => {
    const out = buildUserPrompt({
      body: "Just landed a new role at OpenAI!",
      subject: "Big news",
      fromName: "David Park",
    });
    expect(out).toContain("David Park");
    expect(out).toContain("Big news");
    expect(out).toContain("OpenAI");
  });

  it("works with just a body", () => {
    const out = buildUserPrompt({ body: "Hi there" });
    expect(out).toContain("Hi there");
  });

  it("truncates very long bodies", () => {
    const huge = "x".repeat(10000);
    const out = buildUserPrompt({ body: huge });
    expect(out.length).toBeLessThan(huge.length);
  });
});
