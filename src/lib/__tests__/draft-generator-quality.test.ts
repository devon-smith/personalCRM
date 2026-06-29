import { describe, expect, it } from "vitest";
import { findDraftQualityIssues } from "@/lib/draft-generator";
import type { ReplyContext } from "@/lib/draft-reply-context";

function mkReplyContext(body: string): ReplyContext {
  return {
    latestInbound: {
      fromEmail: "priya@example.com",
      fromName: "Priya Anand",
      subject: "Research deadline and recommendation letter",
      body,
      bodyIsFull: true,
      occurredAt: new Date("2026-06-28T12:00:00Z"),
    },
    threadHistory: [
      {
        direction: "INBOUND",
        fromEmail: "priya@example.com",
        fromName: "Priya Anand",
        subject: "Research deadline and recommendation letter",
        snippet: body.slice(0, 200),
        body,
        bodyIsFull: true,
        occurredAt: new Date("2026-06-28T12:00:00Z"),
      },
    ],
  };
}

describe("findDraftQualityIssues", () => {
  it("rejects placeholder profile text", () => {
    const issues = findDraftQualityIssues(
      {
        quick: "Hi Priya, happy to help.\n\nLove, INSERT_MOMS_FIRST_NAME",
        detailed: "Hi Priya, happy to help.\n\nLove, INSERT_MOMS_FIRST_NAME",
      },
      { context: "reply_email", replyContext: mkReplyContext("Can you review the recommendation letter draft by Friday?") },
    );

    expect(issues).toContain("quick draft contains a placeholder");
    expect(issues).toContain("detailed draft contains a placeholder");
  });

  it("rejects the generic review/follow-up template", () => {
    const issues = findDraftQualityIssues(
      {
        quick:
          "Hi Priya, appreciate you sending this over. I'll take a closer look and follow up with thoughts by end of week.",
        detailed:
          "Hi Priya, appreciate you sending this over. I'll take a closer look and follow up with thoughts by end of week.",
      },
      {
        context: "reply_email",
        replyContext: mkReplyContext(
          "Could you tell me whether the recommendation letter should emphasize research independence or classroom leadership?",
        ),
      },
    );

    expect(issues).toContain(
      "quick draft uses generic review/follow-up template language",
    );
    expect(issues).toContain(
      "detailed draft uses generic review/follow-up template language",
    );
  });

  it("rejects reply drafts that do not reference the inbound topic", () => {
    const issues = findDraftQualityIssues(
      {
        quick: "Hi Priya, thanks for the note. Happy to help.",
        detailed:
          "Hi Priya, thanks for the note. Happy to help and will send more soon.",
      },
      {
        context: "reply_email",
        replyContext: mkReplyContext(
          "For the behavioral economics panel, should we invite David Solomon or someone from the startup ecosystem?",
        ),
      },
    );

    expect(issues).toContain(
      "quick reply does not reference any specific topic from the latest inbound message",
    );
    expect(issues).toContain(
      "detailed reply does not reference any specific topic from the latest inbound message",
    );
  });

  it("accepts a concrete reply anchored to the thread", () => {
    const issues = findDraftQualityIssues(
      {
        quick:
          "Hi Priya, for the behavioral economics panel, I would prioritize the startup ecosystem over David Solomon for this one.",
        detailed:
          "Hi Priya, for the behavioral economics panel, I would prioritize someone from the startup ecosystem over David Solomon. That direction feels more useful for the audience and gives us a sharper discussion than another Goldman-centered conversation.",
      },
      {
        context: "reply_email",
        replyContext: mkReplyContext(
          "For the behavioral economics panel, should we invite David Solomon or someone from the startup ecosystem?",
        ),
      },
    );

    expect(issues).toEqual([]);
  });
});
