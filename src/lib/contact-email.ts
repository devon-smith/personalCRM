export interface ContactEmailShape {
  readonly email: string | null;
  readonly additionalEmails: readonly string[];
}

export function contactHasEmail(
  contact: ContactEmailShape | null,
  email: string,
): boolean {
  if (!contact) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (contact.email?.trim().toLowerCase() === normalized) return true;
  return contact.additionalEmails.some(
    (candidate) => candidate.trim().toLowerCase() === normalized,
  );
}

export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim() || email.trim();
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || email.trim()
  );
}
