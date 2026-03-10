export interface ParsedContact {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  linkedinUrl: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  tags: string[];
  notes: string | null;
}

export interface CsvParseResult {
  contacts: ParsedContact[];
  headers: string[];
  errors: string[];
  rowCount: number;
}

// Common header aliases for auto-mapping
const HEADER_MAP: Record<string, keyof ParsedContact> = {
  // Name
  "name": "name",
  "full name": "name",
  "first name": "name",
  "contact name": "name",
  // Email
  "email": "email",
  "email address": "email",
  "e-mail": "email",
  // Phone
  "phone": "phone",
  "phone number": "phone",
  "mobile": "phone",
  "telephone": "phone",
  // Company
  "company": "company",
  "organization": "company",
  "company name": "company",
  "employer": "company",
  // Role
  "role": "role",
  "title": "role",
  "job title": "role",
  "position": "role",
  // LinkedIn
  "linkedin": "linkedinUrl",
  "linkedin url": "linkedinUrl",
  "url": "linkedinUrl",
  "profile url": "linkedinUrl",
  // Location
  "city": "city",
  "state": "state",
  "province": "state",
  "state/province": "state",
  "country": "country",
  "region": "country",
  // Notes
  "notes": "notes",
  "note": "notes",
  "description": "notes",
  // Tags
  "tags": "tags",
  "labels": "tags",
  "categories": "tags",
};

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }

  fields.push(current.trim());
  return fields;
}

export function autoMapHeaders(
  headers: string[]
): Record<number, keyof ParsedContact> {
  const mapping: Record<number, keyof ParsedContact> = {};

  headers.forEach((header, index) => {
    const normalized = header.toLowerCase().trim();
    const mapped = HEADER_MAP[normalized];
    if (mapped) {
      mapping[index] = mapped;
    }
  });

  return mapping;
}

export function parseCsv(
  csvText: string,
  columnMapping?: Record<number, keyof ParsedContact>
): CsvParseResult {
  const lines = csvText
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return {
      contacts: [],
      headers: [],
      errors: ["CSV must have at least a header row and one data row."],
      rowCount: 0,
    };
  }

  const headers = parseCsvLine(lines[0]);
  const mapping = columnMapping ?? autoMapHeaders(headers);

  // Check that we have at least a name column
  const hasName = Object.values(mapping).includes("name");
  if (!hasName) {
    return {
      contacts: [],
      headers,
      errors: [
        "Could not detect a 'Name' column. Please ensure your CSV has a header like 'Name', 'Full Name', or 'First Name'.",
      ],
      rowCount: 0,
    };
  }

  const contacts: ParsedContact[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const contact: Record<string, string | string[] | null> = {
      name: "",
      email: null,
      phone: null,
      company: null,
      role: null,
      linkedinUrl: null,
      city: null,
      state: null,
      country: null,
      tags: [],
      notes: null,
    };

    // Handle "First Name" + "Last Name" pattern
    let firstName = "";
    let lastName = "";

    for (const [colIndex, field] of Object.entries(mapping)) {
      const value = fields[Number(colIndex)]?.trim() ?? "";
      if (!value) continue;

      if (field === "tags") {
        contact.tags = value
          .split(/[,;|]/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
      } else {
        contact[field] = value;
      }
    }

    // Check for first/last name columns that weren't auto-mapped
    headers.forEach((h, idx) => {
      const normalized = h.toLowerCase().trim();
      if (normalized === "first name") firstName = fields[idx]?.trim() ?? "";
      if (normalized === "last name") lastName = fields[idx]?.trim() ?? "";
    });

    // If name is empty but we have first/last
    if (!contact.name && (firstName || lastName)) {
      contact.name = `${firstName} ${lastName}`.trim();
    }

    if (!contact.name) {
      errors.push(`Row ${i + 1}: Missing name, skipped.`);
      continue;
    }

    contacts.push(contact as unknown as ParsedContact);
  }

  return {
    contacts,
    headers,
    errors,
    rowCount: lines.length - 1,
  };
}
