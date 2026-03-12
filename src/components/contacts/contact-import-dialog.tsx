"use client";

import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Upload, FileText, Check, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { parseCsv, detectLinkedInCsv, type ParsedContact, type CsvParseResult } from "@/lib/csv-parser";
import { parseVcf, isVcardContent } from "@/lib/vcard-parser";

type Step = "upload" | "preview" | "result";

interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
  total: number;
}

interface ContactImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ContactImportDialog({
  open,
  onOpenChange,
}: ContactImportDialogProps) {
  const [step, setStep] = useState<Step>("upload");
  const [parseResult, setParseResult] = useState<CsvParseResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [detectedSource, setDetectedSource] = useState<string>("CSV_IMPORT");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  function handleClose() {
    setStep("upload");
    setParseResult(null);
    setImportResult(null);
    setImporting(false);
    setDetectedSource("CSV_IMPORT");
    onOpenChange(false);
  }

  function handleFileUpload(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      handleParse(text);
    };
    reader.readAsText(file);
  }

  function handlePaste(text: string) {
    if (text.trim()) {
      handleParse(text);
    }
  }

  function handleParse(text: string) {
    let result: CsvParseResult;

    if (isVcardContent(text)) {
      const vcfResult = parseVcf(text);
      result = {
        contacts: vcfResult.contacts,
        headers: ["Name", "Email", "Phone", "Company", "Role"],
        errors: vcfResult.errors,
        rowCount: vcfResult.totalCards,
      };
      setDetectedSource("APPLE_CONTACTS");
    } else {
      result = parseCsv(text);
      // Auto-detect LinkedIn CSV format
      if (detectLinkedInCsv(result.headers)) {
        setDetectedSource("LINKEDIN");
      } else {
        setDetectedSource("CSV_IMPORT");
      }
    }

    setParseResult(result);

    if (result.contacts.length > 0) {
      setStep("preview");
    } else {
      toast.error(
        result.errors[0] ?? "No valid contacts found in the file."
      );
    }
  }

  async function handleImport() {
    if (!parseResult || parseResult.contacts.length === 0) return;

    setImporting(true);
    try {
      const res = await fetch("/api/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: parseResult.contacts, source: detectedSource }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Import failed");
      }

      const result: ImportResult = await res.json();
      setImportResult(result);
      setStep("result");
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Import failed"
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : handleClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Contacts</DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <UploadStep
            fileInputRef={fileInputRef}
            onFileUpload={handleFileUpload}
            onPaste={handlePaste}
          />
        )}

        {step === "preview" && parseResult && (
          <PreviewStep
            result={parseResult}
            importing={importing}
            detectedSource={detectedSource}
            onImport={handleImport}
            onBack={() => setStep("upload")}
          />
        )}

        {step === "result" && importResult && (
          <ResultStep result={importResult} onDone={handleClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function UploadStep({
  fileInputRef,
  onFileUpload,
  onPaste,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileUpload: (file: File) => void;
  onPaste: (text: string) => void;
}) {
  const [pasteText, setPasteText] = useState("");

  return (
    <div className="space-y-6">
      {/* File upload */}
      <div
        className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-gray-300 p-8 transition-colors hover:border-blue-400 hover:bg-blue-50/50"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="h-8 w-8 text-gray-400" />
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">
            Upload a CSV or vCard file
          </p>
          <p className="text-xs text-gray-500">
            Supports .csv and .vcf (Apple Contacts, Outlook)
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.vcf,text/csv,text/vcard,text/x-vcard"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileUpload(file);
          }}
        />
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs text-gray-400">or paste CSV text</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      {/* Paste area */}
      <div className="space-y-2">
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={"Name,Email,Company,Role\nJohn Doe,john@example.com,Acme Inc,Engineer"}
          rows={6}
          className="w-full rounded-md border border-gray-200 px-3 py-2 font-mono text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <Button
          onClick={() => onPaste(pasteText)}
          disabled={!pasteText.trim()}
          className="w-full"
        >
          <FileText className="mr-1.5 h-4 w-4" />
          Parse CSV
        </Button>
      </div>

      {/* Import tips */}
      <div className="space-y-2">
        <div className="rounded-md bg-gray-50 p-3">
          <p className="text-xs font-medium text-gray-700">
            Importing from Apple Contacts?
          </p>
          <p className="text-xs text-gray-500">
            Open Contacts → Select All (⌘A) → File → Export vCard.
            Then upload the .vcf file here.
          </p>
        </div>
        <div className="rounded-md bg-gray-50 p-3">
          <p className="text-xs font-medium text-gray-700">
            Importing from LinkedIn?
          </p>
          <p className="text-xs text-gray-500">
            Go to LinkedIn → Settings → Data Privacy → Get a copy of your data
            → Select &quot;Connections&quot; → Download the CSV.
          </p>
        </div>
      </div>
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  CSV_IMPORT: "CSV Import",
  LINKEDIN: "LinkedIn",
  APPLE_CONTACTS: "Apple Contacts",
  GOOGLE_CONTACTS: "Google Contacts",
};

const SOURCE_COLORS: Record<string, string> = {
  LINKEDIN: "bg-blue-100 text-blue-700",
  APPLE_CONTACTS: "bg-gray-100 text-gray-700",
  CSV_IMPORT: "bg-gray-100 text-gray-600",
  GOOGLE_CONTACTS: "bg-red-50 text-red-600",
};

function PreviewStep({
  result,
  importing,
  detectedSource,
  onImport,
  onBack,
}: {
  result: CsvParseResult;
  importing: boolean;
  detectedSource: string;
  onImport: () => void;
  onBack: () => void;
}) {
  const preview = result.contacts.slice(0, 20);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700">
            {result.contacts.length} contacts ready to import
          </p>
          {result.errors.length > 0 && (
            <p className="text-xs text-yellow-600">
              {result.errors.length} row(s) had issues
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className={SOURCE_COLORS[detectedSource] ?? "bg-gray-100 text-gray-600"}
          >
            {SOURCE_LABELS[detectedSource] ?? detectedSource}
          </Badge>
          <Badge variant="secondary">
            {result.headers.length} columns
          </Badge>
        </div>
      </div>

      {result.errors.length > 0 && (
        <div className="max-h-20 overflow-y-auto rounded-md bg-yellow-50 p-2">
          {result.errors.map((err, i) => (
            <p key={i} className="text-xs text-yellow-700">
              {err}
            </p>
          ))}
        </div>
      )}

      <div className="max-h-64 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Location</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.map((contact, i) => (
              <TableRow key={i}>
                <TableCell className="text-sm font-medium">
                  {contact.name}
                </TableCell>
                <TableCell className="text-xs text-gray-500">
                  {contact.email ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-gray-500">
                  {contact.company ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-gray-500">
                  {[contact.city, contact.state, contact.country]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {result.contacts.length > 20 && (
        <p className="text-center text-xs text-gray-400">
          Showing first 20 of {result.contacts.length} contacts
        </p>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onImport} disabled={importing}>
          {importing ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <Upload className="mr-1.5 h-4 w-4" />
              Import {result.contacts.length} Contacts
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function ResultStep({
  result,
  onDone,
}: {
  result: ImportResult;
  onDone: () => void;
}) {
  return (
    <div className="space-y-4 py-4 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
        <Check className="h-6 w-6 text-green-600" />
      </div>

      <div>
        <p className="text-lg font-semibold text-gray-900">Import Complete</p>
        <div className="mt-2 space-y-1">
          <p className="text-sm text-gray-600">
            <span className="font-medium text-green-600">
              {result.created}
            </span>{" "}
            contacts created
          </p>
          {result.skipped > 0 && (
            <p className="text-sm text-gray-600">
              <span className="font-medium text-yellow-600">
                {result.skipped}
              </span>{" "}
              skipped (duplicates or missing data)
            </p>
          )}
        </div>
      </div>

      {result.errors.length > 0 && (
        <div className="mx-auto max-w-sm rounded-md bg-yellow-50 p-3 text-left">
          <div className="flex items-center gap-1.5 text-xs font-medium text-yellow-700">
            <AlertTriangle className="h-3 w-3" />
            Issues
          </div>
          <div className="mt-1 max-h-20 overflow-y-auto">
            {result.errors.map((err, i) => (
              <p key={i} className="text-xs text-yellow-600">
                {err}
              </p>
            ))}
          </div>
        </div>
      )}

      <Button onClick={onDone}>Done</Button>
    </div>
  );
}
