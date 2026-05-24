import { describe, it, expect } from "vitest";
import {
  isLinkedInNotification,
  parseLinkedInSubject,
} from "@/lib/gmail/linkedin-notifications";

describe("isLinkedInNotification", () => {
  it("matches canonical noreply addresses", () => {
    expect(isLinkedInNotification("news-noreply@linkedin.com")).toBe(true);
    expect(isLinkedInNotification("messages-noreply@linkedin.com")).toBe(true);
    expect(isLinkedInNotification("notifications-noreply@linkedin.com")).toBe(true);
  });

  it("matches subdomains", () => {
    expect(isLinkedInNotification("foo@news-noreply.linkedin.com")).toBe(true);
  });

  it("rejects non-LinkedIn senders", () => {
    expect(isLinkedInNotification("hello@stanford.edu")).toBe(false);
    expect(isLinkedInNotification("noreply@linkedin.fake.com")).toBe(false);
  });

  it("handles missing/malformed input", () => {
    expect(isLinkedInNotification(null)).toBe(false);
    expect(isLinkedInNotification(undefined)).toBe(false);
    expect(isLinkedInNotification("")).toBe(false);
    expect(isLinkedInNotification("notanemail")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isLinkedInNotification("News-Noreply@LinkedIn.com")).toBe(true);
  });
});

describe("parseLinkedInSubject — job changes", () => {
  it("parses 'started a new position as X at Y'", () => {
    const r = parseLinkedInSubject(
      "Marc Beban started a new position as Engineering Lead at Tesla",
    );
    expect(r).toEqual({
      kind: "job_change",
      name: "Marc Beban",
      newRole: "Engineering Lead",
      newCompany: "Tesla",
    });
  });

  it("parses 'started a new role as X at Y'", () => {
    const r = parseLinkedInSubject(
      "Sarah Chen started a new role as VP of Product at Notion",
    );
    expect(r?.kind).toBe("job_change");
    expect(r?.name).toBe("Sarah Chen");
    expect(r?.newRole).toBe("VP of Product");
    expect(r?.newCompany).toBe("Notion");
  });

  it("parses 'started a new position at Y' (no role)", () => {
    const r = parseLinkedInSubject(
      "Alex Tan started a new position at OpenAI",
    );
    expect(r?.kind).toBe("job_change");
    expect(r?.name).toBe("Alex Tan");
    expect(r?.newRole).toBeNull();
    expect(r?.newCompany).toBe("OpenAI");
  });

  it("parses 'is now X at Y'", () => {
    const r = parseLinkedInSubject(
      "Renée García is now Chief Marketing Officer at Salesforce",
    );
    expect(r?.kind).toBe("job_change");
    expect(r?.name).toBe("Renée García");
    expect(r?.newRole).toBe("Chief Marketing Officer");
    expect(r?.newCompany).toBe("Salesforce");
  });

  it("parses 'has started a new position'", () => {
    const r = parseLinkedInSubject(
      "Joe Schmidt IV has started a new position as Director at Acme",
    );
    expect(r?.name).toBe("Joe Schmidt IV");
    expect(r?.newRole).toBe("Director");
    expect(r?.newCompany).toBe("Acme");
  });
});

describe("parseLinkedInSubject — promotions", () => {
  it("parses 'was promoted to X'", () => {
    const r = parseLinkedInSubject("Marcus Williams was promoted to Senior PM");
    expect(r?.kind).toBe("promotion");
    expect(r?.name).toBe("Marcus Williams");
    expect(r?.newRole).toBe("Senior PM");
    expect(r?.newCompany).toBeNull();
  });

  it("parses 'has been promoted to X'", () => {
    const r = parseLinkedInSubject(
      "Yifat Sharabi-Levine has been promoted to Director of Coaching",
    );
    expect(r?.kind).toBe("promotion");
    expect(r?.name).toBe("Yifat Sharabi-Levine");
    expect(r?.newRole).toBe("Director of Coaching");
  });
});

describe("parseLinkedInSubject — must NOT match", () => {
  it("ignores anniversary emails", () => {
    expect(
      parseLinkedInSubject("Congratulate Sarah on 5 years at Notion"),
    ).toBeNull();
    expect(
      parseLinkedInSubject("Sarah Chen's 5-year anniversary at Notion"),
    ).toBeNull();
  });

  it("ignores connection invitations", () => {
    expect(
      parseLinkedInSubject("Marc Beban wants to connect on LinkedIn"),
    ).toBeNull();
    expect(
      parseLinkedInSubject("You have a new connection: Marc Beban"),
    ).toBeNull();
  });

  it("ignores post shares / profile views / reactions", () => {
    expect(parseLinkedInSubject("Marc Beban shared a post")).toBeNull();
    expect(parseLinkedInSubject("Sarah viewed your profile")).toBeNull();
    expect(parseLinkedInSubject("Marc reacted to your post")).toBeNull();
    expect(parseLinkedInSubject("Sarah commented on your post")).toBeNull();
  });

  it("ignores birthdays", () => {
    expect(parseLinkedInSubject("It's Marc's birthday today")).toBeNull();
  });

  it("returns null for unrelated subjects", () => {
    expect(parseLinkedInSubject("Your weekly digest")).toBeNull();
    expect(parseLinkedInSubject("Jobs you might like")).toBeNull();
    expect(parseLinkedInSubject("")).toBeNull();
    expect(parseLinkedInSubject(null)).toBeNull();
    expect(parseLinkedInSubject(undefined)).toBeNull();
  });
});
