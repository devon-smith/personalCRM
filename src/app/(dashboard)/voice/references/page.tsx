"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  Upload,
  Loader2,
  Trash2,
  FileText,
  AlertCircle,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Surface, SectionLabel } from "@/components/ds";

/**
 * /voice/references — voice reference materials (M0.x.5).
 *
 * Upload knowledge-base files, style guides, book excerpts that
 * describe Jennifer's intentional voice. These are weighted higher
 * than her actual sent mail when generating drafts — they represent
 * how she WANTS to write, not just how she has written.
 */

interface VoiceReferenceRow {
  id: string;
  filename: string;
  sourceType: string;
  weight: number;
  byteSize: number;
  guidance: {
    applicableRelationships?: string[];
    greetings?: string[];
    closings?: string[];
    signaturePhrases?: string[];
    avoidPhrases?: string[];
    toneNotes?: string;
  } | null;
  addedAt: string;
}

interface UploadOutcome {
  status: "imported" | "duplicate" | "failed";
  filename: string;
  bytes?: number;
  truncated?: boolean;
  reason?: string;
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  gpt_knowledge_base: "GPT knowledge base",
  manual_upload: "Manual upload",
  book_excerpt: "Book excerpt",
  style_guide: "Style guide",
};

const ACCEPTED_EXT = ".txt,.md,.markdown,.pdf,.docx";

export default function VoiceReferencesPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sourceType, setSourceType] = useState<string>("gpt_knowledge_base");
  const [lastOutcomes, setLastOutcomes] = useState<UploadOutcome[] | null>(null);

  const { data, isLoading } = useQuery<{ references: VoiceReferenceRow[] }>({
    queryKey: ["voice-references"],
    queryFn: async () => {
      const res = await fetch("/api/voice/references");
      if (!res.ok) throw new Error("Failed to load references");
      return res.json();
    },
  });

  const upload = useMutation({
    mutationFn: async (files: FileList | File[]) => {
      const form = new FormData();
      form.append("sourceType", sourceType);
      for (const file of Array.from(files)) {
        form.append("files", file);
      }
      const res = await fetch("/api/voice/references", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Upload failed");
      }
      return res.json() as Promise<{
        outcomes: UploadOutcome[];
        summary: { imported: number; duplicates: number; failed: number };
      }>;
    },
    onSuccess: (result) => {
      setLastOutcomes(result.outcomes);
      qc.invalidateQueries({ queryKey: ["voice-references"] });
      const { imported, duplicates, failed } = result.summary;
      const parts: string[] = [];
      if (imported > 0) parts.push(`${imported} imported`);
      if (duplicates > 0) parts.push(`${duplicates} already on file`);
      if (failed > 0) parts.push(`${failed} failed`);
      toast.success(parts.join(", ") || "Nothing to import");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/voice/references/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["voice-references"] });
      toast.success("Removed");
    },
    onError: () => toast.error("Couldn't remove"),
  });

  const handleFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files || files.length === 0) return;
      upload.mutate(files);
    },
    [upload],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const refs = data?.references ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div>
        <Link
          href="/voice"
          className="inline-flex items-center gap-1 text-[12px]"
          style={{ color: "var(--text-tertiary)" }}
        >
          <ArrowLeft className="h-3 w-3" />
          Voice settings
        </Link>
        <h1
          className="ds-display-md mt-2"
          style={{ color: "var(--text-primary)" }}
        >
          Reference materials
        </h1>
        <p
          className="mt-1 text-[13px]"
          style={{ color: "var(--text-tertiary)" }}
        >
          Upload knowledge-base exports, style guides, or any writing samples
          that capture how you <em>want</em> to write. These dominate over
          your sent-mail patterns when drafts are generated.
        </p>
      </div>

      {/* Source type picker */}
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel>Tagging uploads as</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setSourceType(value)}
              className="inline-flex items-center rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors"
              style={{
                backgroundColor:
                  sourceType === value ? "var(--surface)" : "transparent",
                color:
                  sourceType === value
                    ? "var(--text-primary)"
                    : "var(--text-tertiary)",
                border:
                  sourceType === value
                    ? "1px solid var(--border)"
                    : "1px solid transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Drop zone — uses <label htmlFor> rather than a JS click()
          trick so the file picker opens reliably across browsers.
          The previous `<div onClick={() => ref.click()}>` pattern
          fired into recursive click events through the input child,
          which silently no-op'd in some browsers. */}
      <label
        htmlFor="reference-file-input"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className="block rounded-2xl border-2 border-dashed px-6 py-12 text-center cursor-pointer transition-colors"
        style={{
          borderColor: isDragging ? "var(--accent-color)" : "var(--border)",
          backgroundColor: isDragging
            ? "var(--accent-soft)"
            : "var(--surface-sunken)",
        }}
      >
        <input
          ref={fileInputRef}
          id="reference-file-input"
          type="file"
          multiple
          accept={ACCEPTED_EXT}
          className="sr-only"
          onChange={(e) => {
            handleFiles(e.target.files);
            // Reset so re-uploading the same file fires onChange.
            e.target.value = "";
          }}
        />
        {upload.isPending ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2
              className="h-5 w-5 animate-spin"
              style={{ color: "var(--text-secondary)" }}
            />
            <p
              className="text-[13px]"
              style={{ color: "var(--text-secondary)" }}
            >
              Uploading, extracting text, and summarizing&hellip;
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: "var(--accent-soft)" }}
            >
              <Upload
                className="h-5 w-5"
                style={{ color: "var(--accent-color)" }}
              />
            </div>
            <p
              className="text-[14px] font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              Drop files here or click to pick
            </p>
            <p
              className="text-[12px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              .txt · .md · .pdf · .docx — multiple files supported
            </p>
          </div>
        )}
      </label>

      {/* Last-upload outcome feedback */}
      {lastOutcomes && lastOutcomes.length > 0 && (
        <Surface tone="sand" padded>
          <SectionLabel>Last upload</SectionLabel>
          <div className="mt-2 space-y-1">
            {lastOutcomes.map((o, i) => (
              <div
                key={i}
                className="flex items-start gap-2 text-[12.5px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {o.status === "imported" && (
                  <CheckCircle2
                    className="h-3.5 w-3.5 mt-0.5 shrink-0"
                    style={{ color: "#6B8A6E" }}
                  />
                )}
                {o.status === "duplicate" && (
                  <Sparkles
                    className="h-3.5 w-3.5 mt-0.5 shrink-0"
                    style={{ color: "var(--text-tertiary)" }}
                  />
                )}
                {o.status === "failed" && (
                  <AlertCircle
                    className="h-3.5 w-3.5 mt-0.5 shrink-0"
                    style={{ color: "var(--status-urgent, #DC2626)" }}
                  />
                )}
                <span className="truncate">
                  <span className="font-medium">{o.filename}</span>
                  {o.status === "imported" && o.truncated && (
                    <span style={{ color: "var(--text-tertiary)" }}>
                      {" "}
                      · truncated to fit
                    </span>
                  )}
                  {o.status === "duplicate" && (
                    <span style={{ color: "var(--text-tertiary)" }}>
                      {" "}
                      · already on file
                    </span>
                  )}
                  {o.status === "failed" && o.reason && (
                    <span style={{ color: "var(--text-tertiary)" }}>
                      {" "}
                      · {o.reason}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Surface>
      )}

      {/* Uploaded list */}
      <div>
        <SectionLabel>Your references ({refs.length})</SectionLabel>
        {isLoading ? (
          <div className="py-8 text-center">
            <Loader2
              className="h-4 w-4 animate-spin mx-auto"
              style={{ color: "var(--text-tertiary)" }}
            />
          </div>
        ) : refs.length === 0 ? (
          <p
            className="text-[13px] mt-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            No references yet. Upload your custom GPT knowledge-base files —
            generated drafts will inherit their tone.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {refs.map((row) => (
              <ReferenceRow
                key={row.id}
                row={row}
                onRemove={() => remove.mutate(row.id)}
                removing={remove.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReferenceRow({
  row,
  onRemove,
  removing,
}: {
  row: VoiceReferenceRow;
  onRemove: () => void;
  removing: boolean;
}) {
  const [showGuidance, setShowGuidance] = useState(false);
  const sourceLabel = SOURCE_TYPE_LABELS[row.sourceType] ?? row.sourceType;
  const g = row.guidance;
  const hasGuidance =
    !!g &&
    ((g.greetings?.length ?? 0) > 0 ||
      (g.closings?.length ?? 0) > 0 ||
      (g.signaturePhrases?.length ?? 0) > 0 ||
      (g.avoidPhrases?.length ?? 0) > 0 ||
      (g.toneNotes ?? "").length > 0);
  return (
    <Surface tone="mist" padded>
      <div className="flex items-start gap-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: "var(--surface-sunken)" }}
        >
          <FileText
            className="h-4 w-4"
            style={{ color: "var(--text-tertiary)" }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p
              className="ds-body-sm font-medium truncate"
              style={{ color: "var(--text-primary)" }}
            >
              {row.filename}
            </p>
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium"
              style={{
                backgroundColor: "var(--surface)",
                color: "var(--text-tertiary)",
              }}
            >
              {sourceLabel}
            </span>
            <span
              className="text-[11px] tabular-nums"
              style={{ color: "var(--text-tertiary)" }}
            >
              weight {row.weight.toFixed(1)} · {formatBytes(row.byteSize)}
            </span>
          </div>
          {g?.toneNotes && (
            <p
              className="text-[12px] mt-1"
              style={{
                color: "var(--text-secondary)",
                lineHeight: 1.45,
              }}
            >
              {g.toneNotes}
            </p>
          )}
          {hasGuidance && (
            <button
              onClick={() => setShowGuidance((v) => !v)}
              className="text-[11.5px] mt-1.5"
              style={{ color: "var(--text-tertiary)" }}
            >
              {showGuidance ? "Hide guidance ↑" : "Show extracted guidance ↓"}
            </button>
          )}
          {showGuidance && g && (
            <div className="mt-2 space-y-1.5 text-[12px]" style={{ color: "var(--text-secondary)" }}>
              {(g.greetings?.length ?? 0) > 0 && (
                <div>
                  <strong>Greetings:</strong> {g.greetings!.map((s) => `"${s}"`).join(", ")}
                </div>
              )}
              {(g.closings?.length ?? 0) > 0 && (
                <div>
                  <strong>Closings:</strong> {g.closings!.map((s) => `"${s}"`).join(", ")}
                </div>
              )}
              {(g.signaturePhrases?.length ?? 0) > 0 && (
                <div>
                  <strong>Signature phrases:</strong>
                  <ul className="list-disc pl-5">
                    {g.signaturePhrases!.map((s, i) => (
                      <li key={i}>&ldquo;{s}&rdquo;</li>
                    ))}
                  </ul>
                </div>
              )}
              {(g.avoidPhrases?.length ?? 0) > 0 && (
                <div>
                  <strong>Avoid:</strong> {g.avoidPhrases!.map((s) => `"${s}"`).join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onRemove}
          disabled={removing}
          className="p-1.5 rounded-[10px] transition-colors"
          style={{ color: "var(--text-tertiary)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--accent-soft)";
            e.currentTarget.style.color = "var(--status-urgent, #DC2626)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.color = "var(--text-tertiary)";
          }}
          title="Remove this reference"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </Surface>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
