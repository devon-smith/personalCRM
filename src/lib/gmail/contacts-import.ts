import { googleFetch } from "./client";

export interface GoogleContact {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  photoUrl: string | null;
}

interface PeopleApiPerson {
  resourceName?: string;
  names?: Array<{ displayName?: string; givenName?: string; familyName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
  photos?: Array<{ url?: string; default?: boolean }>;
}

interface PeopleApiResponse {
  connections?: PeopleApiPerson[];
  nextPageToken?: string;
  totalPeople?: number;
}

/**
 * Fetch contacts from Google People API.
 * Returns parsed contacts with name, email, phone, company, role.
 */
export async function fetchGoogleContacts(
  userId: string,
  maxContacts: number = 2000,
): Promise<GoogleContact[]> {
  const contacts: GoogleContact[] = [];
  let pageToken: string | undefined;

  while (contacts.length < maxContacts) {
    const url = new URL("https://people.googleapis.com/v1/people/me/connections");
    url.searchParams.set(
      "personFields",
      "names,emailAddresses,phoneNumbers,organizations,photos",
    );
    url.searchParams.set("pageSize", "100");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const res = await googleFetch(userId, url.toString());

    if (!res.ok) {
      const errorText = await res.text();
      console.error("People API error:", res.status, errorText);
      throw new Error(`Google Contacts API error: ${res.status}`);
    }

    const data = (await res.json()) as PeopleApiResponse;

    for (const person of data.connections ?? []) {
      const parsed = parsePerson(person);
      if (parsed) {
        contacts.push(parsed);
      }
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return contacts.slice(0, maxContacts);
}

function parsePerson(person: PeopleApiPerson): GoogleContact | null {
  const name =
    person.names?.[0]?.displayName ??
    [person.names?.[0]?.givenName, person.names?.[0]?.familyName]
      .filter(Boolean)
      .join(" ");

  // Skip contacts without a name
  if (!name?.trim()) return null;

  const email = person.emailAddresses?.[0]?.value ?? null;
  const phone = person.phoneNumbers?.[0]?.value ?? null;
  const company = person.organizations?.[0]?.name ?? null;
  const role = person.organizations?.[0]?.title ?? null;
  const photo = person.photos?.find((p) => !p.default);
  const photoUrl = photo?.url ?? null;

  return { name: name.trim(), email, phone, company, role, photoUrl };
}
