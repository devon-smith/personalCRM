import { describe, it, expect } from "vitest";
import {
  buildDraftInputFromInboxItem,
  extractLatestPreviewSummary,
  isEligibleForAutoDraft,
} from "@/lib/intelligence/inbox-draft-input";

describe("isEligibleForAutoDraft", () => {
  it.each([["email"], ["gmail"]])(
    'returns true for classified response-needed channel="%s"',
    (channel) => {
      expect(isEligibleForAutoDraft({ channel, needsResponse: true })).toBe(true);
    },
  );

  it.each([["text"], ["iMessage"], ["SMS"], ["linkedin"], ["whatsapp"]])(
    'returns false for non-email channel="%s"',
    (channel) => {
      expect(isEligibleForAutoDraft({ channel, needsResponse: true })).toBe(false);
    },
  );

  it.each([[null], [false]])(
    "returns false unless the classifier marked needsResponse=true",
    (needsResponse) => {
      expect(isEligibleForAutoDraft({ channel: "email", needsResponse })).toBe(false);
    },
  );
});

describe("extractLatestPreviewSummary", () => {
  it("returns the first summary when previews is an array", () => {
    const previews = [
      { summary: "first message", occurredAt: "2026-05-01" },
      { summary: "second message", occurredAt: "2026-05-02" },
    ];
    expect(extractLatestPreviewSummary(previews)).toBe("first message");
  });

  it("skips empty / whitespace summaries", () => {
    const previews = [
      { summary: "   " },
      { summary: "real content" },
    ];
    expect(extractLatestPreviewSummary(previews)).toBe("real content");
  });

  it("returns null when not an array", () => {
    expect(extractLatestPreviewSummary(null)).toBeNull();
    expect(extractLatestPreviewSummary(undefined)).toBeNull();
    expect(extractLatestPreviewSummary("a string")).toBeNull();
    expect(extractLatestPreviewSummary({})).toBeNull();
  });

  it("returns null when array is empty or has no usable summaries", () => {
    expect(extractLatestPreviewSummary([])).toBeNull();
    expect(extractLatestPreviewSummary([{ summary: "" }])).toBeNull();
    expect(extractLatestPreviewSummary([{ occurredAt: "2026-05-01" }])).toBeNull();
  });

  it("trims surrounding whitespace from the returned summary", () => {
    expect(
      extractLatestPreviewSummary([{ summary: "  padded text  " }]),
    ).toBe("padded text");
  });
});

describe("buildDraftInputFromInboxItem", () => {
  const base = {
    id: "inbox-1",
    userId: "user-1",
    contactId: "contact-1",
    channel: "email",
    needsResponse: true,
  };

  it("returns null for ineligible channels", () => {
    expect(
      buildDraftInputFromInboxItem({
        ...base,
        channel: "iMessage",
        messagePreview: [{ summary: "anything" }],
      }),
    ).toBeNull();
  });

  it("maps an email item to a reply_email draft input", () => {
    const out = buildDraftInputFromInboxItem({
      ...base,
      messagePreview: [
        { summary: "Hey, are you free Tuesday to discuss the GSB workshop?" },
      ],
    });
    expect(out).not.toBeNull();
    expect(out).toMatchObject({
      userId: "user-1",
      contactId: "contact-1",
      tone: "warm",
      context: "reply_email",
    });
    expect(out?.threadSubject).toContain("GSB workshop");
    expect(out?.threadSnippet).toContain("GSB workshop");
  });

  it("caps threadSubject at 140 chars but keeps the full snippet", () => {
    const longSummary = "x".repeat(300);
    const out = buildDraftInputFromInboxItem({
      ...base,
      messagePreview: [{ summary: longSummary }],
    });
    expect(out?.threadSubject?.length).toBe(140);
    expect(out?.threadSnippet?.length).toBe(300);
  });

  it("returns undefined subjects + snippets when preview is missing", () => {
    const out = buildDraftInputFromInboxItem({
      ...base,
      messagePreview: null,
    });
    expect(out).not.toBeNull();
    expect(out?.threadSubject).toBeUndefined();
    expect(out?.threadSnippet).toBeUndefined();
  });
});
