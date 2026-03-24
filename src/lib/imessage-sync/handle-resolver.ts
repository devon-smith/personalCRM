import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/name-utils";

// ─── Types ───────────────────────────────────────────────────

export interface ContactLookupMaps {
  readonly byPhone: Map<string, string>;
  readonly byEmail: Map<string, string>;
  readonly byHandle: Map<string, string>;
}

// ─── Build lookup maps from contacts + sync state ────────────

export async function buildContactLookupMaps(userId: string): Promise<ContactLookupMaps> {
  const [contacts, syncStates] = await Promise.all([
    prisma.contact.findMany({
      where: { userId },
      select: { id: true, phone: true, email: true, additionalEmails: true },
    }),
    prisma.iMessageSyncState.findMany({
      where: { userId },
    }),
  ]);

  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();

  for (const c of contacts) {
    if (c.phone) {
      byPhone.set(normalizePhone(c.phone), c.id);
    }
    if (c.email) {
      byEmail.set(c.email.toLowerCase(), c.id);
    }
    for (const extra of c.additionalEmails) {
      byEmail.set(extra.toLowerCase(), c.id);
    }
  }

  const byHandle = new Map<string, string>();
  for (const s of syncStates) {
    if (s.contactId) {
      byHandle.set(s.handleId, s.contactId);
    }
  }

  return { byPhone, byEmail, byHandle };
}

// ─── Resolve a handle (phone/email) to a contactId ──────────

export function resolveHandleToContact(
  handleId: string,
  lookups: ContactLookupMaps,
): string | undefined {
  if (handleId.includes("@")) {
    return lookups.byEmail.get(handleId.toLowerCase());
  }

  const normalized = normalizePhone(handleId);
  let contactId = lookups.byPhone.get(normalized);

  // Suffix match for numbers without country code
  if (!contactId) {
    const digits = normalized.replace(/\D/g, "");
    const last10 = digits.slice(-10);
    for (const [storedPhone, id] of lookups.byPhone) {
      const storedDigits = storedPhone.replace(/\D/g, "");
      if (storedDigits.slice(-10) === last10) {
        contactId = id;
        break;
      }
    }
  }

  // Fallback: previously-matched sync state
  return contactId ?? lookups.byHandle.get(handleId);
}
