import { type ParsedContact } from "./csv-parser";

export interface VcardParseResult {
  contacts: ParsedContact[];
  errors: string[];
  totalCards: number;
}

/**
 * Unfold vCard lines — continuation lines start with a space or tab.
 * RFC 6350 §3.2
 */
function unfoldLines(raw: string): string[] {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

/**
 * Decode quoted-printable encoded strings (used by some vCard exporters).
 */
function decodeQuotedPrintable(value: string): string {
  return value.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

/**
 * Parse a single vCard property line into { name, params, value }.
 * Handles parameterized properties like EMAIL;type=HOME:john@example.com
 */
function parseProperty(line: string): {
  name: string;
  params: string[];
  value: string;
} {
  // Split on first unescaped colon — but colons can appear in values
  // Property format: NAME;PARAM1;PARAM2:VALUE
  const colonIdx = findPropertyColon(line);
  if (colonIdx === -1) {
    return { name: "", params: [], value: "" };
  }

  const left = line.substring(0, colonIdx);
  const value = line.substring(colonIdx + 1);

  const parts = left.split(";");
  const name = (parts[0] ?? "").toUpperCase().trim();
  const params = parts.slice(1).map((p) => p.trim().toUpperCase());

  return { name, params, value };
}

/**
 * Find the colon that separates property name+params from the value.
 * Must handle GROUP.PROPNAME and quoted parameter values.
 */
function findPropertyColon(line: string): number {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ":" && !inQuotes) {
      return i;
    }
  }
  return -1;
}

/**
 * Parse the structured N (name) field.
 * Format: LastName;FirstName;MiddleName;Prefix;Suffix
 */
function parseName(value: string): string {
  const parts = value.split(";").map((p) => p.trim());
  const [last, first, middle] = parts;
  return [first, middle, last].filter(Boolean).join(" ").trim();
}

/**
 * Parse the structured ADR (address) field.
 * Format: PO Box;Extended;Street;City;Region;PostalCode;Country
 */
function parseAddress(value: string): {
  city: string | null;
  state: string | null;
  country: string | null;
} {
  const parts = value.split(";").map((p) => p.trim());
  return {
    city: parts[3] || null,
    state: parts[4] || null,
    country: parts[6] || null,
  };
}

/**
 * Check if a property has quoted-printable encoding.
 */
function isQuotedPrintable(params: string[]): boolean {
  return params.some(
    (p) =>
      p === "ENCODING=QUOTED-PRINTABLE" ||
      p === "QUOTED-PRINTABLE"
  );
}

/**
 * Parse a single vCard block (BEGIN:VCARD ... END:VCARD) into a ParsedContact.
 */
function parseVcard(lines: string[]): ParsedContact | null {
  let name = "";
  let formattedName = "";
  let email: string | null = null;
  let phone: string | null = null;
  let company: string | null = null;
  let role: string | null = null;
  let linkedinUrl: string | null = null;
  let city: string | null = null;
  let state: string | null = null;
  let country: string | null = null;
  let notes: string | null = null;

  for (const line of lines) {
    const prop = parseProperty(line);
    let value = prop.value;

    // Handle quoted-printable encoding
    if (isQuotedPrintable(prop.params)) {
      value = decodeQuotedPrintable(value);
    }

    // Strip group prefixes (e.g., "item1.EMAIL" → "EMAIL")
    const propName = prop.name.includes(".")
      ? prop.name.split(".").pop() ?? prop.name
      : prop.name;

    switch (propName) {
      case "FN":
        formattedName = value.trim();
        break;
      case "N":
        name = parseName(value);
        break;
      case "EMAIL":
        // Take first email only
        if (!email && value.trim()) {
          email = value.trim().toLowerCase();
        }
        break;
      case "TEL":
        // Take first phone only
        if (!phone && value.trim()) {
          phone = value.trim();
        }
        break;
      case "ORG":
        // ORG can be semicolon-separated (org;department)
        if (!company) {
          company = value.split(";")[0]?.trim() || null;
        }
        break;
      case "TITLE":
        if (!role) {
          role = value.trim() || null;
        }
        break;
      case "ROLE":
        // ROLE is a fallback if TITLE isn't set
        if (!role) {
          role = value.trim() || null;
        }
        break;
      case "ADR": {
        // Take first address with actual data
        if (!city && !state && !country) {
          const addr = parseAddress(value);
          city = addr.city;
          state = addr.state;
          country = addr.country;
        }
        break;
      }
      case "URL": {
        const url = value.trim().toLowerCase();
        if (url.includes("linkedin.com")) {
          linkedinUrl = value.trim();
        }
        break;
      }
      case "NOTE":
        notes = value.trim() || null;
        break;
    }
  }

  // Prefer FN (formatted name), fall back to structured N
  const finalName = formattedName || name;
  if (!finalName) return null;

  return {
    name: finalName,
    email,
    phone,
    company,
    role,
    linkedinUrl,
    city,
    state,
    country,
    tags: [],
    notes,
  };
}

/**
 * Parse a .vcf file containing one or more vCards.
 * Supports vCard 2.1, 3.0, and 4.0 formats.
 */
export function parseVcf(vcfText: string): VcardParseResult {
  const lines = unfoldLines(vcfText);
  const contacts: ParsedContact[] = [];
  const errors: string[] = [];

  let currentCard: string[] = [];
  let insideCard = false;
  let cardIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.toUpperCase() === "BEGIN:VCARD") {
      insideCard = true;
      currentCard = [];
      cardIndex++;
      continue;
    }

    if (trimmed.toUpperCase() === "END:VCARD") {
      if (insideCard) {
        const contact = parseVcard(currentCard);
        if (contact) {
          contacts.push(contact);
        } else {
          errors.push(`Card ${cardIndex}: Missing name, skipped.`);
        }
      }
      insideCard = false;
      currentCard = [];
      continue;
    }

    if (insideCard && trimmed) {
      currentCard.push(trimmed);
    }
  }

  return {
    contacts,
    errors,
    totalCards: cardIndex,
  };
}

/**
 * Detect whether a file's content is vCard format.
 */
export function isVcardContent(text: string): boolean {
  const trimmed = text.trimStart().toUpperCase();
  return trimmed.startsWith("BEGIN:VCARD");
}
