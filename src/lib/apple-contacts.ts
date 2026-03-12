import { execFile } from "child_process";
import { readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { type ParsedContact } from "./csv-parser";

export interface AppleContactsResult {
  contacts: ParsedContact[];
  total: number;
  error: string | null;
}

interface RawSqliteContact {
  firstName: string | null;
  lastName: string | null;
  organization: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  linkedinUrl: string | null;
  note: string | null;
}

/**
 * Find all AddressBook SQLite databases across all synced sources.
 */
function findContactDatabases(): string[] {
  const sourcesDir = join(
    homedir(),
    "Library",
    "Application Support",
    "AddressBook",
    "Sources",
  );

  const dbs: string[] = [];

  if (!existsSync(sourcesDir)) return dbs;

  try {
    const sources = readdirSync(sourcesDir);
    for (const source of sources) {
      const dbPath = join(sourcesDir, source, "AddressBook-v22.abcddb");
      if (existsSync(dbPath)) {
        dbs.push(dbPath);
      }
    }
  } catch {
    // Fall back to main DB
  }

  // Also check the root DB
  const rootDb = join(
    homedir(),
    "Library",
    "Application Support",
    "AddressBook",
    "AddressBook-v22.abcddb",
  );
  if (existsSync(rootDb)) {
    dbs.push(rootDb);
  }

  return dbs;
}

/**
 * Query a single AddressBook SQLite database.
 */
function queryDatabase(dbPath: string): Promise<RawSqliteContact[]> {
  const query = `
    SELECT
      r.ZFIRSTNAME as firstName,
      r.ZLASTNAME as lastName,
      r.ZORGANIZATION as organization,
      r.ZJOBTITLE as jobTitle,
      (SELECT e.ZADDRESS FROM ZABCDEMAILADDRESS e WHERE e.ZOWNER = r.Z_PK LIMIT 1) as email,
      (SELECT p.ZFULLNUMBER FROM ZABCDPHONENUMBER p WHERE p.ZOWNER = r.Z_PK LIMIT 1) as phone,
      (SELECT a.ZCITY FROM ZABCDPOSTALADDRESS a WHERE a.ZOWNER = r.Z_PK LIMIT 1) as city,
      (SELECT a.ZSTATE FROM ZABCDPOSTALADDRESS a WHERE a.ZOWNER = r.Z_PK LIMIT 1) as state,
      (SELECT a.ZCOUNTRYNAME FROM ZABCDPOSTALADDRESS a WHERE a.ZOWNER = r.Z_PK LIMIT 1) as country,
      (SELECT u.ZURL FROM ZABCDURLADDRESS u WHERE u.ZOWNER = r.Z_PK AND LOWER(u.ZURL) LIKE '%linkedin%' LIMIT 1) as linkedinUrl,
      (SELECT n.ZTEXT FROM ZABCDNOTE n WHERE n.ZCONTACT = r.Z_PK LIMIT 1) as note
    FROM ZABCDRECORD r
    WHERE r.ZFIRSTNAME IS NOT NULL
       OR r.ZLASTNAME IS NOT NULL
       OR r.ZORGANIZATION IS NOT NULL;
  `.trim();

  return new Promise((resolve) => {
    execFile(
      "sqlite3",
      ["-json", dbPath, query],
      { timeout: 10000, maxBuffer: 50 * 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve([]);
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve([]);
        }
      },
    );
  });
}

/**
 * Build a display name from first/last/organization.
 */
function buildName(
  first: string | null,
  last: string | null,
  org: string | null,
): string {
  const name = [first, last].filter(Boolean).join(" ").trim();
  return name || org || "";
}

/**
 * Read contacts from macOS AddressBook SQLite databases.
 * No permissions dialogs — reads the DB files directly.
 * ~60ms for thousands of contacts vs 30s+ with osascript.
 */
export async function readAppleContacts(): Promise<AppleContactsResult> {
  const dbPaths = findContactDatabases();

  if (dbPaths.length === 0) {
    return {
      contacts: [],
      total: 0,
      error: "No AddressBook database found. Make sure Contacts.app has been used on this Mac.",
    };
  }

  // Query all source databases in parallel
  const results = await Promise.all(dbPaths.map(queryDatabase));
  const allRaw = results.flat();

  // Deduplicate by email (contacts can appear in multiple sources)
  const seen = new Set<string>();
  const contacts: ParsedContact[] = [];

  for (const raw of allRaw) {
    const name = buildName(raw.firstName, raw.lastName, raw.organization);
    if (!name) continue;

    // Dedup key: email if available, otherwise name
    const key = raw.email
      ? raw.email.toLowerCase().trim()
      : name.toLowerCase();

    if (seen.has(key)) continue;
    seen.add(key);

    contacts.push({
      name,
      email: raw.email?.toLowerCase().trim() || null,
      phone: raw.phone?.trim() || null,
      company: raw.organization?.trim() || null,
      role: raw.jobTitle?.trim() || null,
      linkedinUrl: raw.linkedinUrl?.trim() || null,
      city: raw.city?.trim() || null,
      state: raw.state?.trim() || null,
      country: raw.country?.trim() || null,
      tags: [],
      notes: raw.note?.trim() || null,
    });
  }

  return { contacts, total: contacts.length, error: null };
}
