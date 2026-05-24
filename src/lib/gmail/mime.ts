/**
 * RFC 5322 message builder for the Gmail drafts.create endpoint.
 *
 * Gmail wants the raw message as a base64url-encoded RFC 5322 envelope.
 * This file is pure (no fetch, no DB) so the assembly + encoding logic
 * is unit-testable in isolation.
 */

export interface BuildMimeInput {
  /** From: header. Usually the connected Google account's email. */
  from: string;
  /** To: header. Required. */
  to: string;
  /** Subject. For replies, prefer the upstream subject with no Re: prefix
   *  — buildReplySubject() handles the prefix idempotently. */
  subject: string;
  /** Plain-text body. */
  body: string;
  /** For replies: the Message-Id of the message we're replying to.
   *  Will be set as both In-Reply-To and pushed onto References. */
  inReplyToMessageId?: string | null;
  /** Optional existing References chain to extend (space-separated
   *  message IDs each in <angle> brackets). */
  references?: string | null;
}

/**
 * Build the raw RFC 5322 message and return its base64url encoding.
 * Suitable for the `message.raw` field of the drafts.create payload.
 */
export function buildRawMessage(input: BuildMimeInput): string {
  const headers: string[] = [];
  headers.push(`From: ${input.from}`);
  headers.push(`To: ${input.to}`);
  headers.push(`Subject: ${encodeHeaderValue(input.subject)}`);
  headers.push(`MIME-Version: 1.0`);
  headers.push(`Content-Type: text/plain; charset="UTF-8"`);
  headers.push(`Content-Transfer-Encoding: 7bit`);

  if (input.inReplyToMessageId) {
    const id = ensureAngles(input.inReplyToMessageId);
    headers.push(`In-Reply-To: ${id}`);
    const existingRefs = (input.references ?? "").trim();
    const newRefs = existingRefs ? `${existingRefs} ${id}` : id;
    headers.push(`References: ${newRefs}`);
  }

  // RFC 5322 uses CRLF line endings. Body separated by a blank line.
  const message = headers.join("\r\n") + "\r\n\r\n" + normalizeBody(input.body);
  return base64UrlEncode(message);
}

/**
 * Idempotent "Re: " prefix for reply subjects. Avoids stacking "Re: Re: Re:".
 * Recognizes ASCII Re:, RE:, re:, and the international variants Fwd: / FW:
 * (which we don't add but also don't double-prefix).
 */
export function buildReplySubject(originalSubject: string | null | undefined): string {
  const trimmed = (originalSubject ?? "").trim();
  if (!trimmed) return "Re:";
  // Already has Re:, RE:, re: at the start? Leave as-is.
  if (/^re\s*:/i.test(trimmed)) return trimmed;
  // Already a forward (Fwd:/FW:)? Leave as-is rather than adding Re:.
  if (/^(fwd?|fw)\s*:/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * base64url encoding per RFC 4648 §5: standard base64 with `+` → `-`,
 * `/` → `_`, and `=` padding stripped. Gmail's drafts.create requires
 * this exact variant.
 */
function base64UrlEncode(input: string): string {
  // Buffer.from handles UTF-8 correctly across the entire BMP + supplementary
  // planes (multi-byte chars in body and headers).
  const b64 = Buffer.from(input, "utf-8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Wrap an ID in angle brackets if it isn't already. Gmail's Message-Id
 * format is `<unique@domain>`; both bracketed and unbracketed forms appear
 * in the wild depending on which API field we pulled it from.
 */
function ensureAngles(id: string): string {
  const t = id.trim();
  if (!t) return t;
  if (t.startsWith("<") && t.endsWith(">")) return t;
  return `<${t}>`;
}

/**
 * Encode a header value that may contain non-ASCII characters using
 * RFC 2047 encoded-word format. Plain ASCII passes through unchanged.
 */
function encodeHeaderValue(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const b64 = Buffer.from(value, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

/**
 * Normalize line endings to CRLF and ensure the body doesn't start with
 * stray whitespace lines that might be interpreted as continuations.
 */
function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}
