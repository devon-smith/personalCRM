import { getAllGoogleAccessTokens } from "./client";

export interface GoogleContact {
  name: string;
  email: string | null;
  additionalEmails: string[];
  phone: string | null;
  company: string | null;
  role: string | null;
  photoUrl: string | null;
  birthday: string | null; // ISO date string e.g. "1995-03-12"
}

interface PeopleApiPerson {
  resourceName?: string;
  names?: Array<{ displayName?: string; givenName?: string; familyName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
  photos?: Array<{ url?: string; default?: boolean }>;
  birthdays?: Array<{ date?: { year?: number; month?: number; day?: number } }>;
}

interface PeopleApiResponse {
  connections?: PeopleApiPerson[];
  nextPageToken?: string;
  totalPeople?: number;
}

/**
 * Fetch contacts from Google People API across ALL linked accounts.
 * Deduplicates by primary email address.
 */
export async function fetchGoogleContacts(
  userId: string,
  maxContacts: number = 2000,
): Promise<GoogleContact[]> {
  const accountTokens = await getAllGoogleAccessTokens(userId);
  if (accountTokens.length === 0) {
    throw new Error("No valid Google access token. User may need to reconnect.");
  }

  const contactsByEmail = new Map<string, GoogleContact>();
  const contactsWithoutEmail: GoogleContact[] = [];

  for (const { token } of accountTokens) {
    try {
      const accountContacts = await fetchContactsWithToken(token, maxContacts);
      for (const contact of accountContacts) {
        if (contact.email) {
          // Deduplicate by primary email
          if (!contactsByEmail.has(contact.email.toLowerCase())) {
            contactsByEmail.set(contact.email.toLowerCase(), contact);
          }
        } else {
          contactsWithoutEmail.push(contact);
        }
      }
    } catch (err) {
      // Skip accounts that don't have contacts scope
      console.error("Contacts fetch error for account:", err instanceof Error ? err.message : err);
    }
  }

  return [...contactsByEmail.values(), ...contactsWithoutEmail].slice(0, maxContacts);
}

async function fetchContactsWithToken(
  token: string,
  maxContacts: number,
): Promise<GoogleContact[]> {
  const contacts: GoogleContact[] = [];
  let pageToken: string | undefined;

  while (contacts.length < maxContacts) {
    const url = new URL("https://people.googleapis.com/v1/people/me/connections");
    url.searchParams.set(
      "personFields",
      "names,emailAddresses,phoneNumbers,organizations,photos,birthdays",
    );
    url.searchParams.set("pageSize", "100");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

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

  const allEmails = (person.emailAddresses ?? [])
    .map((e) => e.value?.trim())
    .filter((v): v is string => !!v);
  const email = allEmails[0] ?? null;
  const additionalEmails = allEmails.slice(1);
  const phone = person.phoneNumbers?.[0]?.value ?? null;
  const company = person.organizations?.[0]?.name ?? null;
  const role = person.organizations?.[0]?.title ?? null;
  const photo = person.photos?.find((p) => !p.default);
  const photoUrl = photo?.url ?? null;

  // Parse birthday from Google People API format { year, month, day }
  const bdayData = person.birthdays?.[0]?.date;
  let birthday: string | null = null;
  if (bdayData?.month && bdayData?.day) {
    const year = bdayData.year ?? 1900; // year may be missing for privacy
    const month = String(bdayData.month).padStart(2, "0");
    const day = String(bdayData.day).padStart(2, "0");
    birthday = `${year}-${month}-${day}`;
  }

  return { name: name.trim(), email, additionalEmails, phone, company, role, photoUrl, birthday };
}
