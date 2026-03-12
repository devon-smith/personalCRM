"use client";

import { useState, useRef, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  Loader2,
  Check,
  AlertTriangle,
  ExternalLink,
  Users,
  Merge,
  UserPlus,
  FileQuestion,
  Briefcase,
  Link2,
  PenLine,
  ChevronDown,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import type { LinkedInImportResult } from "@/app/api/import/linkedin/route";
import type { CircleWithContacts } from "@/lib/hooks/use-circles";

interface LinkedInRow {
  firstName: string;
  lastName: string;
  email: string | null;
  company: string | null;
  position: string | null;
  connectedOn: string | null;
  url: string | null;
}

type Step = "upload" | "preview" | "importing" | "result" | "circles";

// ─── CSV parsing ────────────────────────────────────────────

/** Strip academic/professional suffixes from a last name, e.g. "Cornelius, PhD" → "Cornelius" */
const LAST_NAME_SUFFIX_RE = /,?\s*(phd|md|mba|cfa|cpa|esq|dds|jr\.?|sr\.?|ii|iii|iv)\s*$/i;

function cleanLastName(raw: string): string {
  return raw.replace(LAST_NAME_SUFFIX_RE, "").trim();
}

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
          i++;
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

function parseLinkedInCsv(text: string): { rows: LinkedInRow[]; errors: string[] } {
  const lines = text.split(/\r?\n/);

  // LinkedIn CSVs have 3 disclaimer rows before the actual header.
  // Find the real header row: the line starting with "First Name"
  let headerIndex = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const trimmed = lines[i].trim();
    if (trimmed.toLowerCase().startsWith("first name")) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    return {
      rows: [],
      errors: [
        'Could not find the header row starting with "First Name". ' +
        "Make sure this is a LinkedIn Connections export CSV.",
      ],
    };
  }

  const headers = parseCsvLine(lines[headerIndex]).map((h) => h.toLowerCase().trim());

  const firstNameIdx = headers.findIndex((h) => h === "first name");
  const lastNameIdx = headers.findIndex((h) => h === "last name");
  const emailIdx = headers.findIndex((h) => h === "email address" || h === "email");
  const companyIdx = headers.findIndex((h) => h === "company");
  const positionIdx = headers.findIndex((h) => h === "position" || h === "title");
  const connectedOnIdx = headers.findIndex((h) => h === "connected on");
  const urlIdx = headers.findIndex((h) => h === "url");

  if (firstNameIdx === -1 || lastNameIdx === -1) {
    return {
      rows: [],
      errors: [
        'Could not find "First Name" and "Last Name" columns. ' +
        "Make sure this is a LinkedIn Connections export CSV.",
      ],
    };
  }

  const rows: LinkedInRow[] = [];
  const errors: string[] = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCsvLine(lines[i]);
    const firstName = fields[firstNameIdx]?.trim() ?? "";
    const rawLastName = fields[lastNameIdx]?.trim() ?? "";
    const lastName = cleanLastName(rawLastName);

    if (!firstName && !lastName) {
      errors.push(`Row ${i + 1}: Missing name, skipped.`);
      continue;
    }

    rows.push({
      firstName,
      lastName,
      email: emailIdx >= 0 ? fields[emailIdx]?.trim() || null : null,
      company: companyIdx >= 0 ? fields[companyIdx]?.trim() || null : null,
      position: positionIdx >= 0 ? fields[positionIdx]?.trim() || null : null,
      connectedOn: connectedOnIdx >= 0 ? fields[connectedOnIdx]?.trim() || null : null,
      url: urlIdx >= 0 ? fields[urlIdx]?.trim() || null : null,
    });
  }

  return { rows, errors };
}

// ─── Component ──────────────────────────────────────────────

export function LinkedInImport() {
  const [step, setStep] = useState<Step>("upload");
  const [rows, setRows] = useState<LinkedInRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<LinkedInImportResult | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const importMutation = useMutation({
    mutationFn: async (importRows: LinkedInRow[]) => {
      const res = await fetch("/api/import/linkedin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: importRows }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Import failed");
      }
      return res.json() as Promise<LinkedInImportResult>;
    },
    onSuccess: (data) => {
      setImportResult(data);
      // If there are new contacts, go to circle assignment wizard
      if (data.newContacts > 0) {
        setStep("circles");
      } else {
        setStep("result");
      }
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["sightings-review"] });
    },
    onError: (err) => {
      toast.error(err.message);
      setStep("preview");
    },
  });

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { rows: parsed, errors } = parseLinkedInCsv(text);
      setRows(parsed);
      setParseErrors(errors);

      if (parsed.length > 0) {
        setStep("preview");
      } else {
        toast.error(errors[0] ?? "No valid connections found in this file.");
      }
    };
    reader.readAsText(file);
  }

  function handleImport() {
    setStep("importing");
    importMutation.mutate(rows);
  }

  function reset() {
    setStep("upload");
    setRows([]);
    setParseErrors([]);
    setImportResult(null);
  }

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".csv")) {
      handleFile(file);
    } else {
      toast.error("Please drop a .csv file");
    }
  }, []);

  // Stats for preview
  const withEmail = rows.filter((r) => r.email).length;
  const withCompany = rows.filter((r) => r.company).length;
  const withUrl = rows.filter((r) => r.url).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="crm-section-label">LinkedIn Import</p>
        <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-[10px]">
          LinkedIn
        </Badge>
      </div>

      {/* Upload step */}
      {step === "upload" && (
        <div className="space-y-3">
          <div
            className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors ${
              dragActive
                ? "border-blue-500 bg-blue-50"
                : "border-gray-200 hover:border-gray-400 hover:bg-gray-50"
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
          >
            <Upload className="h-6 w-6 text-gray-400" />
            <div className="text-center">
              <p className="text-[13px] font-medium text-gray-700">
                Drop your LinkedIn CSV here
              </p>
              <p className="text-[11px] text-gray-400 mt-1">
                or click to browse
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>

          <div className="rounded-xl bg-gray-50 p-3 space-y-1.5">
            <p className="text-[12px] font-medium text-gray-700">
              How to export from LinkedIn:
            </p>
            <ol className="text-[11px] text-gray-500 space-y-0.5 list-decimal ml-3.5">
              <li>Go to LinkedIn Settings &amp; Privacy</li>
              <li>Data Privacy &rarr; Get a copy of your data</li>
              <li>Select &quot;Connections&quot; only</li>
              <li>Download the CSV file</li>
            </ol>
          </div>
        </div>
      )}

      {/* Preview step */}
      {step === "preview" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[14px] font-semibold text-gray-900">
                Found {rows.length.toLocaleString()} LinkedIn connections
              </p>
              <p className="text-[12px] text-gray-400 mt-0.5">
                {withEmail} with email, {withCompany} with company, {withUrl} with profile URL
              </p>
            </div>
            <Badge variant="secondary" className="bg-blue-100 text-blue-700">
              LinkedIn export detected
            </Badge>
          </div>

          {parseErrors.length > 0 && (
            <div className="rounded-lg bg-yellow-50 p-2 max-h-16 overflow-y-auto">
              {parseErrors.map((err, i) => (
                <p key={i} className="text-[11px] text-yellow-700">{err}</p>
              ))}
            </div>
          )}

          {/* Preview table (first 5 rows) */}
          <div className="rounded-lg border overflow-auto max-h-56">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Name</TableHead>
                  <TableHead className="text-[11px]">Company</TableHead>
                  <TableHead className="text-[11px]">Position</TableHead>
                  <TableHead className="text-[11px]">Email</TableHead>
                  <TableHead className="text-[11px]">Connected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 5).map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-[12px] font-medium">
                      {row.firstName} {row.lastName}
                    </TableCell>
                    <TableCell className="text-[11px] text-gray-500">
                      {row.company ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-[11px] text-gray-500">
                      {row.position ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-[11px] text-gray-500">
                      {row.email ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-[11px] text-gray-500">
                      {row.connectedOn ?? "\u2014"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {rows.length > 5 && (
            <p className="text-center text-[11px] text-gray-400">
              Showing first 5 of {rows.length.toLocaleString()} connections
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reset}>
              Back
            </Button>
            <Button size="sm" className="flex-1 gap-2" onClick={handleImport}>
              <Upload className="h-3.5 w-3.5" />
              Import {rows.length.toLocaleString()} connections
            </Button>
          </div>
        </div>
      )}

      {/* Importing step */}
      {step === "importing" && (
        <div className="flex flex-col items-center py-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400 mb-3" />
          <p className="text-[14px] font-medium text-gray-900">
            Importing connections...
          </p>
          <p className="text-[12px] text-gray-400 mt-1">
            Running identity resolution on {rows.length.toLocaleString()} contacts
          </p>
        </div>
      )}

      {/* Circle assignment wizard */}
      {step === "circles" && importResult && (
        <CircleAssignmentWizard
          result={importResult}
          rows={rows}
          onDone={() => setStep("result")}
        />
      )}

      {/* Result step */}
      {step === "result" && importResult && (
        <ResultScreen result={importResult} onReset={reset} />
      )}
    </div>
  );
}

// ─── Result screen ──────────────────────────────────────────

function ResultScreen({
  result,
  onReset,
}: {
  result: LinkedInImportResult;
  onReset: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pb-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
          <Check className="h-5 w-5 text-green-600" />
        </div>
        <div>
          <p className="text-[14px] font-semibold text-gray-900">
            LinkedIn Import Complete
          </p>
          <p className="text-[12px] text-gray-400">
            {result.total.toLocaleString()} connections processed
          </p>
        </div>
      </div>

      {/* Detailed merge breakdown */}
      {result.autoMerged > 0 && (
        <div className="rounded-xl bg-blue-50 p-3 space-y-1">
          <div className="flex items-center gap-1.5">
            <Merge className="h-3.5 w-3.5 text-blue-600" />
            <span className="text-[12px] font-medium text-blue-700">
              Matched to existing contacts: {result.autoMerged}
            </span>
          </div>
          <div className="ml-5 space-y-0.5 text-[11px] text-blue-600">
            {result.matchBreakdown.byEmail > 0 && (
              <p>&bull; by email: {result.matchBreakdown.byEmail}</p>
            )}
            {result.matchBreakdown.byNameCompany > 0 && (
              <p>&bull; by name + company: {result.matchBreakdown.byNameCompany}</p>
            )}
            {result.matchBreakdown.byLinkedInUrl > 0 && (
              <p>&bull; by LinkedIn URL: {result.matchBreakdown.byLinkedInUrl}</p>
            )}
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatBox
          icon={UserPlus}
          label="New contacts"
          value={result.newContacts}
          detail="no existing match found"
          color="text-green-600"
          bg="bg-green-50"
        />
        <StatBox
          icon={FileQuestion}
          label="Needs review"
          value={result.reviewNeeded}
          detail="possible matches to confirm"
          color="text-amber-600"
          bg="bg-amber-50"
        />
        <StatBox
          icon={Link2}
          label="LinkedIn URLs added"
          value={result.linkedInUrlsAdded}
          detail="to existing contacts"
          color="text-purple-600"
          bg="bg-purple-50"
        />
        <StatBox
          icon={PenLine}
          label="Company/title updated"
          value={result.companyUpdates}
          detail="enriched from LinkedIn"
          color="text-indigo-600"
          bg="bg-indigo-50"
        />
      </div>

      {/* Job changes */}
      {result.jobChanges.length > 0 && (
        <div className="rounded-xl bg-amber-50 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-amber-700">
            <Briefcase className="h-3.5 w-3.5" />
            {result.jobChanges.length} possible job changes
          </div>
          <div className="max-h-24 overflow-y-auto space-y-1">
            {result.jobChanges.map((jc, i) => (
              <p key={i} className="text-[11px] text-amber-600">
                {jc.name}: {jc.oldCompany} &rarr; {jc.newCompany}
              </p>
            ))}
          </div>
        </div>
      )}

      <Button variant="outline" size="sm" onClick={onReset} className="w-full">
        Import another file
      </Button>
    </div>
  );
}

// ─── Circle assignment wizard ───────────────────────────────

interface CompanyGroup {
  company: string;
  count: number;
  selectedCircleId: string | null;
}

function CircleAssignmentWizard({
  result,
  rows,
  onDone,
}: {
  result: LinkedInImportResult;
  rows: LinkedInRow[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: circles } = useQuery<CircleWithContacts[]>({
    queryKey: ["circles"],
    queryFn: async () => {
      const res = await fetch("/api/circles");
      if (!res.ok) throw new Error("Failed to fetch circles");
      return res.json();
    },
  });

  // Group new contacts by company (only the ones just created)
  const companyGroups = buildCompanyGroups(rows, circles ?? []);
  const [assignments, setAssignments] = useState<Map<string, string | null>>(
    () => {
      const map = new Map<string, string | null>();
      for (const g of companyGroups) {
        map.set(g.company, g.selectedCircleId);
      }
      return map;
    },
  );
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [newCircleName, setNewCircleName] = useState("");

  const applyMutation = useMutation({
    mutationFn: async (groupAssignments: { company: string; circleId: string }[]) => {
      // For each assignment, find contacts from the import with that company and add them to the circle
      const res = await fetch("/api/import/linkedin/assign-circles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments: groupAssignments }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to assign circles");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["circles"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Contacts assigned to circles");
      onDone();
    },
    onError: (err) => toast.error(err.message),
  });

  const createCircleMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/circles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to create circle");
      }
      return res.json() as Promise<{ id: string; name: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["circles"] });
      if (creating) {
        setAssignments((prev) => {
          const next = new Map(prev);
          next.set(creating, data.id);
          return next;
        });
      }
      setCreating(null);
      setNewCircleName("");
      toast.success(`Created circle "${data.name}"`);
    },
    onError: (err) => toast.error(err.message),
  });

  function handleApply() {
    const active: { company: string; circleId: string }[] = [];
    for (const [company, circleId] of assignments) {
      if (circleId) {
        active.push({ company, circleId });
      }
    }
    if (active.length === 0) {
      onDone();
      return;
    }
    applyMutation.mutate(active);
  }

  const visibleGroups = showAll ? companyGroups : companyGroups.slice(0, 8);
  const hasMore = companyGroups.length > 8 && !showAll;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pb-1">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
          <Users className="h-5 w-5 text-blue-600" />
        </div>
        <div>
          <p className="text-[14px] font-semibold text-gray-900">
            Assign to Circles
          </p>
          <p className="text-[12px] text-gray-400">
            {result.newContacts} new contacts grouped by company
          </p>
        </div>
      </div>

      <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
        {visibleGroups.map((group) => (
          <div
            key={group.company}
            className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 bg-gray-50"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-gray-900 truncate">
                {group.company}
              </p>
              <p className="text-[10px] text-gray-400">
                {group.count} {group.count === 1 ? "person" : "people"}
              </p>
            </div>

            {creating === group.company ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newCircleName}
                  onChange={(e) => setNewCircleName(e.target.value)}
                  placeholder="Circle name"
                  className="w-28 rounded border border-gray-200 px-2 py-1 text-[11px] outline-none focus:border-blue-500"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newCircleName.trim()) {
                      createCircleMutation.mutate(newCircleName.trim());
                    }
                    if (e.key === "Escape") {
                      setCreating(null);
                      setNewCircleName("");
                    }
                  }}
                  autoFocus
                />
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    if (newCircleName.trim()) createCircleMutation.mutate(newCircleName.trim());
                  }}
                  disabled={!newCircleName.trim() || createCircleMutation.isPending}
                >
                  {createCircleMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Add"
                  )}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <select
                  value={assignments.get(group.company) ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "__create__") {
                      setCreating(group.company);
                      setNewCircleName(group.company);
                      return;
                    }
                    setAssignments((prev) => {
                      const next = new Map(prev);
                      next.set(group.company, val || null);
                      return next;
                    });
                  }}
                  className="h-7 rounded border border-gray-200 px-2 text-[11px] bg-white min-w-[120px]"
                >
                  <option value="">Skip</option>
                  {circles?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="__create__">+ Create circle</option>
                </select>
              </div>
            )}
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setShowAll(true)}
          className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors mx-auto"
        >
          <ChevronDown className="h-3 w-3" />
          Show {companyGroups.length - 8} more companies
        </button>
      )}

      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onDone}>
          Skip
        </Button>
        <Button
          size="sm"
          className="flex-1 gap-2"
          onClick={handleApply}
          disabled={applyMutation.isPending}
        >
          {applyMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Users className="h-3.5 w-3.5" />
          )}
          Apply Circle Assignments
        </Button>
      </div>
    </div>
  );
}

/**
 * Group imported rows by normalized company, sorted by count descending.
 * Pre-select circles whose name matches the company via substring.
 */
function buildCompanyGroups(
  rows: LinkedInRow[],
  circles: CircleWithContacts[],
): CompanyGroup[] {
  const counts = new Map<string, { original: string; count: number }>();

  for (const row of rows) {
    if (!row.company) continue;
    const norm = row.company.toLowerCase().trim();
    const existing = counts.get(norm);
    if (existing) {
      existing.count++;
    } else {
      counts.set(norm, { original: row.company, count: 1 });
    }
  }

  const groups: CompanyGroup[] = [];
  for (const [, { original, count }] of counts) {
    // Try to pre-match to an existing circle
    const normCompany = original.toLowerCase();
    const matchedCircle = circles.find((c) => {
      const normCircle = c.name.toLowerCase();
      return normCompany.includes(normCircle) || normCircle.includes(normCompany);
    });

    groups.push({
      company: original,
      count,
      selectedCircleId: matchedCircle?.id ?? null,
    });
  }

  return groups.sort((a, b) => b.count - a.count);
}

// ─── Stat box ───────────────────────────────────────────────

function StatBox({
  icon: Icon,
  label,
  value,
  detail,
  color,
  bg,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  detail: string;
  color: string;
  bg: string;
}) {
  return (
    <div className={`rounded-xl ${bg} p-3`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <span className={`text-[11px] font-medium ${color}`}>{label}</span>
      </div>
      <p className={`text-[20px] font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-gray-500 mt-0.5">{detail}</p>
    </div>
  );
}
