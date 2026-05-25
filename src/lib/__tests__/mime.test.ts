import { describe, it, expect } from "vitest";
import { buildRawMessage, buildReplySubject } from "@/lib/gmail/mime";

function decode(raw: string): string {
  // Reverse base64url for verification.
  const pad = "=".repeat((4 - (raw.length % 4)) % 4);
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64").toString("utf-8");
}

describe("buildReplySubject", () => {
  it('adds "Re: " to a fresh subject', () => {
    expect(buildReplySubject("Coffee next week?")).toBe("Re: Coffee next week?");
  });

  it('does not double-prefix existing "Re:"', () => {
    expect(buildReplySubject("Re: Coffee next week?")).toBe("Re: Coffee next week?");
  });

  it("recognizes case variants", () => {
    expect(buildReplySubject("RE: foo")).toBe("RE: foo");
    expect(buildReplySubject("re: foo")).toBe("re: foo");
  });

  it("does not prefix a forward", () => {
    expect(buildReplySubject("Fwd: foo")).toBe("Fwd: foo");
    expect(buildReplySubject("FW: foo")).toBe("FW: foo");
  });

  it('returns bare "Re:" for empty subject', () => {
    expect(buildReplySubject("")).toBe("Re:");
    expect(buildReplySubject(null)).toBe("Re:");
    expect(buildReplySubject(undefined)).toBe("Re:");
  });
});

describe("buildRawMessage", () => {
  it("emits required headers in CRLF format", () => {
    const raw = buildRawMessage({
      from: "me@example.com",
      to: "you@example.com",
      subject: "Hello",
      body: "Hi there.",
    });
    const decoded = decode(raw);
    expect(decoded).toContain("From: me@example.com\r\n");
    expect(decoded).toContain("To: you@example.com\r\n");
    expect(decoded).toContain("Subject: Hello\r\n");
    expect(decoded).toContain("MIME-Version: 1.0\r\n");
    expect(decoded).toContain("Content-Type: text/plain; charset=\"UTF-8\"\r\n");
    expect(decoded).toMatch(/\r\n\r\nHi there\.$/);
  });

  it("uses base64url alphabet (no +, /, or = padding)", () => {
    const raw = buildRawMessage({
      from: "me@example.com",
      to: "you@example.com",
      subject: "?? ?? ??", // forces base64 expansion w/ likely + or /
      body: Array(50).fill("test data >>>").join(" "),
    });
    expect(raw).not.toMatch(/[+/=]/);
  });

  it("sets In-Reply-To and References for a reply", () => {
    const raw = buildRawMessage({
      from: "me@example.com",
      to: "you@example.com",
      subject: "Re: thing",
      body: "Sounds good",
      inReplyToMessageId: "<abc123@mail.example.com>",
    });
    const decoded = decode(raw);
    expect(decoded).toContain("In-Reply-To: <abc123@mail.example.com>\r\n");
    expect(decoded).toContain("References: <abc123@mail.example.com>\r\n");
  });

  it("extends an existing References chain", () => {
    const raw = buildRawMessage({
      from: "me@example.com",
      to: "you@example.com",
      subject: "Re: thing",
      body: "ok",
      inReplyToMessageId: "<new@mail.example.com>",
      references: "<old1@mail.example.com> <old2@mail.example.com>",
    });
    const decoded = decode(raw);
    expect(decoded).toContain(
      "References: <old1@mail.example.com> <old2@mail.example.com> <new@mail.example.com>\r\n",
    );
  });

  it("auto-wraps unbracketed Message-Ids in angles", () => {
    const raw = buildRawMessage({
      from: "me@example.com",
      to: "you@example.com",
      subject: "Re: x",
      body: "ok",
      inReplyToMessageId: "bare-no-angles@example.com",
    });
    const decoded = decode(raw);
    expect(decoded).toContain("In-Reply-To: <bare-no-angles@example.com>\r\n");
  });

  it("base64-encodes a non-ASCII subject as RFC 2047 encoded-word", () => {
    const raw = buildRawMessage({
      from: "me@example.com",
      to: "you@example.com",
      subject: "Café meeting",
      body: "ok",
    });
    const decoded = decode(raw);
    expect(decoded).toMatch(/Subject: =\?UTF-8\?B\?.+\?=\r\n/);
  });

  it("preserves UTF-8 in the body", () => {
    const raw = buildRawMessage({
      from: "me@example.com",
      to: "you@example.com",
      subject: "x",
      body: "Hola Café 你好 🎉",
    });
    const decoded = decode(raw);
    expect(decoded).toContain("Hola Café 你好 🎉");
  });

  it("normalizes LF to CRLF in body content", () => {
    const raw = buildRawMessage({
      from: "me@example.com",
      to: "you@example.com",
      subject: "x",
      body: "line one\nline two\nline three",
    });
    const decoded = decode(raw);
    expect(decoded).toContain("line one\r\nline two\r\nline three");
  });

  it("emits multipart/alternative when htmlBody is provided", () => {
    const raw = buildRawMessage({
      from: "me@example.com",
      to: "you@example.com",
      subject: "Brief",
      body: "Plain version",
      htmlBody: "<p>HTML <b>version</b></p>",
    });
    const decoded = decode(raw);
    expect(decoded).toMatch(/Content-Type: multipart\/alternative; boundary="crm-[^"]+"/);
    // Both parts must be present.
    expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(decoded).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(decoded).toContain("Plain version");
    expect(decoded).toContain("<p>HTML <b>version</b></p>");
    // Multipart must terminate with the closing boundary.
    expect(decoded).toMatch(/--crm-[^\r\n]+--\r\n$/);
  });

  it("falls back to plain text when htmlBody is empty or whitespace", () => {
    const raw = buildRawMessage({
      from: "me@example.com",
      to: "you@example.com",
      subject: "x",
      body: "plain only",
      htmlBody: "   ",
    });
    const decoded = decode(raw);
    expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(decoded).not.toContain("multipart/alternative");
  });
});
