import { describe, expect, it } from "vitest";
import { contactHasEmail, displayNameFromEmail } from "@/lib/contact-email";

describe("contactHasEmail", () => {
  it("matches primary email case-insensitively", () => {
    expect(
      contactHasEmail(
        { email: "Joy.Lrho@Gmail.com", additionalEmails: [] },
        "joy.lrho@gmail.com",
      ),
    ).toBe(true);
  });

  it("matches additional emails case-insensitively", () => {
    expect(
      contactHasEmail(
        {
          email: "primary@example.com",
          additionalEmails: ["Liz.Walker@Example.com"],
        },
        "liz.walker@example.com",
      ),
    ).toBe(true);
  });

  it("returns false for empty or missing contact data", () => {
    expect(contactHasEmail(null, "person@example.com")).toBe(false);
    expect(contactHasEmail({ email: null, additionalEmails: [] }, "")).toBe(false);
    expect(
      contactHasEmail(
        { email: "person@example.com", additionalEmails: [] },
        "other@example.com",
      ),
    ).toBe(false);
  });
});

describe("displayNameFromEmail", () => {
  it("turns common local-part separators into a readable name", () => {
    expect(displayNameFromEmail("joy.lieberthal-rho@gmail.com")).toBe(
      "Joy Lieberthal Rho",
    );
  });
});
