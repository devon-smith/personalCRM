/**
 * Extract a phone number from a WhatsApp JID.
 *
 * JID formats:
 *   open-wa individual: 15551234567@c.us
 *   open-wa group:      120363012345@g.us
 *
 * (Baileys uses @s.whatsapp.net for individuals; the parsing here is
 * suffix-agnostic so the same helper works for both sidecars.)
 *
 * Returns null for group JIDs.
 */
export function jidToPhone(jid: string): string | null {
  if (isGroupJid(jid)) return null;
  const raw = jid.split("@")[0];
  if (!raw || !/^\d+$/.test(raw)) return null;
  return "+" + raw;
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith("@g.us");
}
