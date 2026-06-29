import { getAllGoogleAccessTokens, googleFetchWithToken } from "./client";
import { cleanContactName } from "@/lib/contacts/clean-name";
import { prisma } from "@/lib/prisma";

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
  metadata?: {
    deleted?: boolean;
  };
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
  nextSyncToken?: string;
  totalPeople?: number;
}

/**
 * Fetch contacts from Google People API across ALL linked accounts.
 *
 * Uses per-account sync tokens: the first call to a new account does a full
 * sync and requests a syncToken; subsequent calls pass that token and only
 * receive deltas. On 410 the token has expired — we drop it and re-run a
 * full sync transparently.
 *
 * Deduplicates by primary email address across accounts.
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

  for (const { accountId, token } of accountTokens) {
    try {
      const accountContacts = await fetchContactsForAccount(
        userId,
        accountId,
        token,
        maxContacts,
      );
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
      console.error(
        "Contacts fetch error for account:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return [...contactsByEmail.values(), ...contactsWithoutEmail].slice(0, maxContacts);
}

/**
 * Fetch for a single account, using the persisted nextSyncToken when present.
 * Returns the parsed contact list. Deleted persons are skipped silently —
 * deletion semantics are not handled at the caller layer yet.
 */
async function fetchContactsForAccount(
  userId: string,
  accountId: string,
  token: string,
  maxContacts: number,
): Promise<GoogleContact[]> {
  const cursor = await prisma.contactsSyncCursor.findUnique({
    where: { userId_accountId: { userId, accountId } },
  });

  // First-ever sync, or no token saved: do a full sync that requests a token.
  if (!cursor?.nextSyncToken) {
    const { contacts, nextSyncToken } = await runFullSync(
      userId,
      accountId,
      token,
      maxContacts,
    );
    await saveCursor(userId, accountId, nextSyncToken, { fullSync: true });
    return contacts;
  }

  // Incremental sync against the saved token.
  try {
    const { contacts, nextSyncToken } = await runIncrementalSync(
      userId,
      accountId,
      token,
      cursor.nextSyncToken,
      maxContacts,
    );
    await saveCursor(userId, accountId, nextSyncToken, { fullSync: false });
    return contacts;
  } catch (err) {
    // 410 Gone: token expired. Wipe cursor and fall back to full sync.
    if (err instanceof TokenExpiredError) {
      const { contacts, nextSyncToken } = await runFullSync(
        userId,
        accountId,
        token,
        maxContacts,
      );
      await saveCursor(userId, accountId, nextSyncToken, { fullSync: true });
      return contacts;
    }
    throw err;
  }
}

class TokenExpiredError extends Error {
  constructor() {
    super("People API syncToken expired (410)");
    this.name = "TokenExpiredError";
  }
}

// Hard safety cap on pagination loops. People API page size is 100, so this
// covers 20k connections. Prevents runaway in the rare event Google never
// stops returning nextPageToken.
const MAX_SYNC_PAGES = 200;

async function runFullSync(
  userId: string,
  accountId: string,
  token: string,
  maxContacts: number,
): Promise<{ contacts: GoogleContact[]; nextSyncToken: string | null }> {
  const contacts: GoogleContact[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  // Must paginate to the last page to capture nextSyncToken — Google only
  // emits it on the final page. Returned contacts are truncated to
  // maxContacts afterward.
  for (let page = 0; page < MAX_SYNC_PAGES; page++) {
    const url = peopleEndpoint({ pageToken, requestSyncToken: true });
    const data = await callPeopleApi(url, token, {
      userId,
      accountId,
      mode: "full",
      page,
    });

    for (const person of data.connections ?? []) {
      const parsed = parsePerson(person);
      if (parsed) contacts.push(parsed);
    }

    if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return { contacts: contacts.slice(0, maxContacts), nextSyncToken };
}

async function runIncrementalSync(
  userId: string,
  accountId: string,
  token: string,
  syncToken: string,
  maxContacts: number,
): Promise<{ contacts: GoogleContact[]; nextSyncToken: string | null }> {
  const contacts: GoogleContact[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  // Same pagination invariant as full sync — keep going until the API
  // signals the last page, then truncate output.
  for (let page = 0; page < MAX_SYNC_PAGES; page++) {
    const url = peopleEndpoint({ pageToken, syncToken });
    const data = await callPeopleApi(url, token, {
      userId,
      accountId,
      mode: "incremental",
      page,
    });

    for (const person of data.connections ?? []) {
      const parsed = parsePerson(person);
      if (parsed) contacts.push(parsed);
    }

    if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return { contacts: contacts.slice(0, maxContacts), nextSyncToken };
}

function peopleEndpoint(opts: {
  pageToken?: string;
  syncToken?: string;
  requestSyncToken?: boolean;
}): URL {
  const url = new URL("https://people.googleapis.com/v1/people/me/connections");
  url.searchParams.set(
    "personFields",
    "names,emailAddresses,phoneNumbers,organizations,photos,birthdays",
  );
  url.searchParams.set("pageSize", "100");
  if (opts.pageToken) url.searchParams.set("pageToken", opts.pageToken);
  if (opts.syncToken) url.searchParams.set("syncToken", opts.syncToken);
  if (opts.requestSyncToken) url.searchParams.set("requestSyncToken", "true");
  return url;
}

async function callPeopleApi(
  url: URL,
  token: string,
  telemetry: {
    userId: string;
    accountId: string;
    mode: "full" | "incremental";
    page: number;
  },
): Promise<PeopleApiResponse> {
  const res = await googleFetchWithToken(token, url.toString(), undefined, {
    userId: telemetry.userId,
    service: "people",
    operation: "people.connections.list",
    feature: "google_contacts_import",
    metadata: {
      accountId: telemetry.accountId,
      mode: telemetry.mode,
      page: telemetry.page,
      pageToken: Boolean(url.searchParams.get("pageToken")),
      syncToken: Boolean(url.searchParams.get("syncToken")),
      requestSyncToken: url.searchParams.get("requestSyncToken") === "true",
    },
  });

  if (res.status === 410) {
    throw new TokenExpiredError();
  }

  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 400 && isExpiredSyncTokenError(errorText)) {
      throw new TokenExpiredError();
    }
    console.error("People API error:", res.status, errorText);
    throw new Error(`Google Contacts API error: ${res.status}`);
  }

  return (await res.json()) as PeopleApiResponse;
}

function isExpiredSyncTokenError(errorText: string): boolean {
  return errorText.includes("EXPIRED_SYNC_TOKEN") ||
    /sync token is expired/i.test(errorText);
}

async function saveCursor(
  userId: string,
  accountId: string,
  nextSyncToken: string | null,
  opts: { fullSync: boolean },
): Promise<void> {
  const now = new Date();
  await prisma.contactsSyncCursor.upsert({
    where: { userId_accountId: { userId, accountId } },
    create: {
      userId,
      accountId,
      nextSyncToken,
      lastSyncAt: now,
      lastFullSyncAt: opts.fullSync ? now : null,
    },
    update: {
      nextSyncToken,
      lastSyncAt: now,
      ...(opts.fullSync ? { lastFullSyncAt: now } : {}),
    },
  });
}

function parsePerson(person: PeopleApiPerson): GoogleContact | null {
  // Incremental sync returns deletions with metadata.deleted=true. Skip them
  // for now — caller doesn't have deletion semantics wired up yet.
  if (person.metadata?.deleted) return null;

  const rawName =
    person.names?.[0]?.displayName ??
    [person.names?.[0]?.givenName, person.names?.[0]?.familyName]
      .filter(Boolean)
      .join(" ");

  const allEmails = (person.emailAddresses ?? [])
    .map((e) => e.value?.trim())
    .filter((v): v is string => !!v);
  const email = allEmails[0] ?? null;

  const cleaned = cleanContactName({ name: rawName ?? null, email });
  if (!cleaned.name) return null;

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

  return { name: cleaned.name, email, additionalEmails, phone, company, role, photoUrl, birthday };
}
