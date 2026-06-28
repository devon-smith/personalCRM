const EMAIL_ADDRESS_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function normalizeEmailAddress(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export function extractEmailAddresses(headerValue: string | null | undefined): string[] {
  const matches = headerValue?.match(EMAIL_ADDRESS_RE) ?? [];
  const seen = new Set<string>();

  for (const match of matches) {
    const normalized = normalizeEmailAddress(match);
    if (normalized) seen.add(normalized);
  }

  return Array.from(seen);
}

export function findUserRecipient(
  recipientEmails: readonly string[],
  userEmails: ReadonlySet<string>,
): string | null {
  return recipientEmails.find((email) => userEmails.has(email)) ?? null;
}
