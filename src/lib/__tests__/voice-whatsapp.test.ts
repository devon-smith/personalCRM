import { describe, it, expect } from "vitest";
import { extractFeatures } from "@/lib/voice/feature-extraction";

/**
 * M0.x.13 — Sanity tests for running the email-shaped feature extractor
 * on WhatsApp message bodies. The point is to verify that the extractor
 * is benign for short, no-signature, no-quote-chain messages — not that
 * it produces rich voice signal (it usually won't from a one-liner).
 *
 * The voice corpus worker passes [] for signatureLines on the WA path
 * so the per-user signature stripper is a no-op here.
 */

describe("voice extractor on WhatsApp message shape (M0.x.13)", () => {
  it("returns a useful feature set on a casual one-liner", () => {
    const out = extractFeatures("yeah let's do friday at noon", []);
    expect(out.wordCount).toBeGreaterThanOrEqual(5);
    expect(out.opening).toBe("none");
    // Single short sentence has no trailing closing-shaped token.
    expect(out.closing === "none" || out.closing === "other").toBe(true);
  });

  it("strips a WhatsApp-style quoted reply (>) prefix", () => {
    const body = `> sounds good for friday?\n\nyep, let's do noon`;
    const out = extractFeatures(body, []);
    expect(out.cleanedBody).not.toContain("sounds good for friday");
    expect(out.cleanedBody).toContain("yep");
  });

  it("preserves a multi-sentence reply", () => {
    const body = "Got it. I'll grab coffee on the way. See you then!";
    const out = extractFeatures(body, []);
    expect(out.wordCount).toBeGreaterThanOrEqual(10);
    expect(out.avgSentenceLen).toBeGreaterThan(0);
  });

  it("does not invent a signature block from short message tails", () => {
    // A bare name on the last line shouldn't be treated as a sig — the
    // detector's threshold is 5+ matches across the corpus, and we pass
    // [] here. Sanity check that nothing falls over.
    const body = "ok\nrunning late\n— j";
    const out = extractFeatures(body, []);
    expect(out.cleanedBody.length).toBeGreaterThan(0);
  });

  it("ignores email-style 'On <date> wrote:' chains that aren't present", () => {
    // Just verifies the email-aware strippers don't false-positive on
    // ordinary WA chat content.
    const body = "did marc say anything about the on-site? he wrote a long reply yesterday";
    const out = extractFeatures(body, []);
    expect(out.cleanedBody).toContain("marc");
    expect(out.cleanedBody).toContain("on-site");
  });
});
