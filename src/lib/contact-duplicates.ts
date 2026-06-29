export interface DuplicateGroup {
  key: string;
  normalizedName: string;
  contacts: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    role: string | null;
    source: string;
    tier: string;
    lastInteraction: string | null;
    interactionCount: number;
    createdAt: string;
  }[];
  matchType: "exact_name" | "name_and_email" | "name_and_phone";
}

interface DuplicateContactInput {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  source: string;
  tier: string;
  lastInteraction: Date | null;
  createdAt: Date;
  _count: { interactions: number };
}

export function normalizeDuplicatePhone(phone: string): string {
  return phone.replace(/[\s\-()+]/g, "").replace(/^1/, "");
}

export function normalizeDuplicateName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

function serializeDuplicateContact(contact: DuplicateContactInput) {
  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    company: contact.company,
    role: contact.role,
    source: contact.source,
    tier: contact.tier,
    lastInteraction: contact.lastInteraction?.toISOString() ?? null,
    interactionCount: contact._count.interactions,
    createdAt: contact.createdAt.toISOString(),
  };
}

export function buildDuplicateGroups(
  contacts: DuplicateContactInput[],
): DuplicateGroup[] {
  const byName = new Map<string, DuplicateContactInput[]>();
  for (const contact of contacts) {
    const key = normalizeDuplicateName(contact.name);
    const group = byName.get(key) ?? [];
    group.push(contact);
    byName.set(key, group);
  }

  const byPhone = new Map<string, DuplicateContactInput[]>();
  for (const contact of contacts) {
    if (!contact.phone) continue;
    const key = normalizeDuplicatePhone(contact.phone);
    if (key.length < 7) continue;
    const group = byPhone.get(key) ?? [];
    group.push(contact);
    byPhone.set(key, group);
  }

  const byEmail = new Map<string, DuplicateContactInput[]>();
  for (const contact of contacts) {
    if (!contact.email) continue;
    const key = contact.email.toLowerCase().trim();
    const group = byEmail.get(key) ?? [];
    group.push(contact);
    byEmail.set(key, group);
  }

  const groups: DuplicateGroup[] = [];
  const seenIds = new Set<string>();

  for (const [normalizedName, group] of byName) {
    if (group.length < 2) continue;

    const contactIds = group.map((contact) => contact.id);
    if (contactIds.every((id) => seenIds.has(id))) continue;
    contactIds.forEach((id) => seenIds.add(id));

    groups.push({
      key: `name:${normalizedName}`,
      normalizedName,
      matchType: "exact_name",
      contacts: group.map(serializeDuplicateContact),
    });
  }

  for (const [phone, group] of byPhone) {
    if (group.length < 2) continue;
    const names = new Set(group.map((contact) => normalizeDuplicateName(contact.name)));
    if (names.size < 2) continue;

    const contactIds = group.map((contact) => contact.id);
    if (contactIds.every((id) => seenIds.has(id))) continue;
    contactIds.forEach((id) => seenIds.add(id));

    groups.push({
      key: `phone:${phone}`,
      normalizedName: group.map((contact) => contact.name).join(" / "),
      matchType: "name_and_phone",
      contacts: group.map(serializeDuplicateContact),
    });
  }

  for (const [email, group] of byEmail) {
    if (group.length < 2) continue;
    const names = new Set(group.map((contact) => normalizeDuplicateName(contact.name)));
    if (names.size < 2) continue;

    const contactIds = group.map((contact) => contact.id);
    if (contactIds.every((id) => seenIds.has(id))) continue;
    contactIds.forEach((id) => seenIds.add(id));

    groups.push({
      key: `email:${email}`,
      normalizedName: group.map((contact) => contact.name).join(" / "),
      matchType: "name_and_email",
      contacts: group.map(serializeDuplicateContact),
    });
  }

  groups.sort(
    (a, b) =>
      b.contacts.length - a.contacts.length ||
      a.normalizedName.localeCompare(b.normalizedName),
  );

  return groups;
}
