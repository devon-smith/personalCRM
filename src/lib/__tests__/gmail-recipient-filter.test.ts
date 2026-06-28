import { describe, expect, it } from "vitest";
import {
  extractEmailAddresses,
  findUserRecipient,
  normalizeEmailAddress,
} from "@/lib/gmail/recipient-filter";

describe("gmail recipient filtering", () => {
  it("extracts addresses from display-name headers", () => {
    expect(
      extractEmailAddresses('"Smith, Devon" <DevonTJSmith@gmail.com>, Priya <priya@example.edu>'),
    ).toEqual(["devontjsmith@gmail.com", "priya@example.edu"]);
  });

  it("deduplicates and normalizes addresses", () => {
    expect(
      extractEmailAddresses("Devon <DEVONTJSMITH@gmail.com>, devontjsmith@gmail.com"),
    ).toEqual(["devontjsmith@gmail.com"]);
  });

  it("finds a user address in To/Cc recipient lists", () => {
    const userEmails = new Set(["devontjsmith@gmail.com", "devon@lab.edu"]);

    expect(
      findUserRecipient(
        ["team@example.edu", "devon@lab.edu", "collab@example.edu"],
        userEmails,
      ),
    ).toBe("devon@lab.edu");
  });

  it("does not match group messages that are not addressed to the user", () => {
    const userEmails = new Set(["devontjsmith@gmail.com"]);

    expect(
      findUserRecipient(
        ["other-person@example.edu", "group-list@example.edu"],
        userEmails,
      ),
    ).toBeNull();
  });

  it("normalizes blank addresses to null", () => {
    expect(normalizeEmailAddress("  ")).toBeNull();
  });
});
