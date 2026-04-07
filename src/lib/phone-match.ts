import { prisma } from "@/lib/prisma";

/**
 * Strip a phone string to digits only, then keep the last 10.
 * Handles "+1 (555) 123-4567" → "5551234567"
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-10);
}

/**
 * Compare two phone numbers by their last 10 digits.
 */
export function phonesMatch(a: string, b: string): boolean {
  return normalizePhone(a) === normalizePhone(b);
}

/**
 * Find a contact by phone number.
 * Tries primary phone, then additionalPhones array.
 */
export async function findContactByPhone(
  userId: string,
  phone: string,
): Promise<{ id: string; name: string } | null> {
  const normalized = normalizePhone(phone);
  if (normalized.length < 7) return null;

  // Fetch contacts that have any phone data
  const contacts = await prisma.contact.findMany({
    where: {
      userId,
      OR: [
        { phone: { not: null } },
        { additionalPhones: { isEmpty: false } },
      ],
    },
    select: { id: true, name: true, phone: true, additionalPhones: true },
  });

  for (const c of contacts) {
    // Check primary phone
    if (c.phone && normalizePhone(c.phone) === normalized) {
      return { id: c.id, name: c.name };
    }

    // Check additional phones
    for (const ap of c.additionalPhones) {
      if (normalizePhone(ap) === normalized) {
        return { id: c.id, name: c.name };
      }
    }
  }

  return null;
}
