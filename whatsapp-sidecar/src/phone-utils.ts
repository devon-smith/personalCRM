/**
 * Extract a phone number from a WhatsApp JID.
 * JIDs look like: 15551234567@s.whatsapp.net (individual)
 * or 120363012345@g.us (group).
 * Returns null for group JIDs.
 */
export function jidToPhone(jid: string): string | null {
  if (isGroupJid(jid)) return null;
  const raw = jid.split("@")[0];
  if (!raw || !/^\d+$/.test(raw)) return null;
  return "+" + raw;
}

/**
 * Check if a JID is a group chat.
 */
export function isGroupJid(jid: string): boolean {
  return jid.endsWith("@g.us");
}

/**
 * Normalize a phone number to its last 10 digits.
 * Useful for comparing numbers regardless of country code format.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-10);
}
