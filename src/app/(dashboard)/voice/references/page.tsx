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
import {
  mergeVoiceReferenceRows,
  type VoiceReferenceCacheRow,
} from "@/lib/voice/reference-cache";
import type {
  LearnedProfile,
  LearnedRelationshipBucket,
  PatternFreq,
} from "@/lib/voice/profile";
import type { RelationshipType } from "@/lib/voice/relationship-classifier";

/**
 * /voice/references — voice reference materials (M0.x.5).
 *
 * Upload knowledge-base files, style guides, book excerpts that
 * describe Jennifer's intentional voice. These are weighted higher
 * than her actual sent mail when generating drafts — they represent
 * how she WANTS to write, not just how she has written.
 */

type VoiceReferenceRow = VoiceReferenceCacheRow;

interface VoiceReferencesBootstrapResponse {
  profile: {
    learned: LearnedProfile;
    indexedEmailCount: number;
    lastIndexedAt: string | null;
  };
  references: VoiceReferenceRow[];
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
const VOICE_BOOTSTRAP_STALE_MS = 5 * 60 * 1000;
const PRIORITY_RELATIONSHIPS: RelationshipType[] = [
  "casual",
  "unknown",
  "peer_faculty",
];

const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  former_student: "Former students",
  peer_faculty: "Peer faculty",
  industry_exec: "Industry execs",
  media: "Media",
  family: "Family",
  board: "Board / advisors",
  casual: "Friends + casual",
  unknown: "Unclassified",
};

const OPENING_LABELS: Record<string, string> = {
  first_name: "First name",
  hi: "Hi,",
  hey: "Hey,",
  hello: "Hello,",
  dear: "Dear,",
  none: "(no greeting)",
  other: "Other",
};

const CLOSING_LABELS: Record<string, string> = {
  warmly: "Warmly,",
  best: "Best,",
  cheers: "Cheers,",
  thanks: "Thanks,",
  thank_you: "Thank you,",
  sincerely: "Sincerely,",
  regards: "Regards,",
  talk_soon: "Talk soon,",
  xo: "xo",
  none: "(no closing)",
  other: "Other",
};

export default function VoiceReferencesPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sourceType, setSourceType] = useState<string>("gpt_knowledge_base");
  const [lastOutcomes, setLastOutcomes] = useState<UploadOutcome[] | null>(null);

  const { data, isLoading } = useQuery<VoiceReferencesBootstrapResponse>({
    queryKey: ["voice", "bootstrap"],
    queryFn: async () => {
      const res = await fetch("/api/voice/bootstrap");
      if (!res.ok) throw new Error("Failed to load voice reference data");
      return res.json();
    },
    staleTime: VOICE_BOOTSTRAP_STALE_MS,
    refetchOnWindowFocus: false,
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
        importedReferences: VoiceReferenceRow[];
        summary: { imported: number; duplicates: number; failed: number };
      }>;
    },
    onSuccess: (result) => {
      setLastOutcomes(result.outcomes);
      if (result.importedReferences.length > 0) {
        qc.setQueryData<VoiceReferencesBootstrapResponse>(
          ["voice", "bootstrap"],
          (current) => current
            ? {
                ...current,
                references: mergeVoiceReferenceRows(
                  current.references,
                  result.importedReferences,
                ),
              }
            : current,
        );
      }
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
    onSuccess: (_data, id) => {
      qc.setQueryData<VoiceReferencesBootstrapResponse>(
        ["voice", "bootstrap"],
        (current) => current
          ? {
              ...current,
              references: current.references.filter((ref) => ref.id !== id),
            }
          : current,
      );
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
  const profile = data?.profile;

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
          Response patterns
        </h1>
        <p
          className="mt-1 text-[13px]"
          style={{ color: "var(--text-tertiary)" }}
        >
          Relationship-specific tables showing how you tend to respond to
          friends, unclassified contacts, and peer faculty. Reference uploads
          still live below and override learned patterns when drafts are
          generated.
        </p>
      </div>

      <RelationshipResponseTables
        learned={profile?.learned ?? null}
        isLoading={isLoading}
        indexedEmailCount={profile?.indexedEmailCount ?? 0}
      />

      <div>
        <SectionLabel>Reference uploads</SectionLabel>
        <p className="mt-1 text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          Upload knowledge-base exports, style guides, or writing samples that
          capture how you want to write.
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

function RelationshipResponseTables({
  learned,
  isLoading,
  indexedEmailCount,
}: {
  learned: LearnedProfile | null;
  isLoading: boolean;
  indexedEmailCount: number;
}) {
  if (isLoading) {
    return (
      <Surface tone="stone" padded>
        <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading response patterns...
        </div>
      </Surface>
    );
  }

  if (!learned || indexedEmailCount === 0) {
    return (
      <Surface tone="sand" padded>
        <SectionLabel>Response tables</SectionLabel>
        <p className="mt-2 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          No voice corpus has been indexed yet. Run the voice re-index from
          Voice settings to populate relationship-specific response tables.
        </p>
      </Surface>
    );
  }

  const rows = PRIORITY_RELATIONSHIPS.map((type) => ({
    type,
    bucket: learned.byRelationship[type],
  }));

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <SectionLabel>How you respond</SectionLabel>
          <p className="mt-1 text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Based on {indexedEmailCount.toLocaleString()} indexed sent emails.
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        {rows.map(({ type, bucket }) => (
          <RelationshipResponseTable
            key={type}
            type={type}
            bucket={bucket}
          />
        ))}
      </div>
    </section>
  );
}

function RelationshipResponseTable({
  type,
  bucket,
}: {
  type: RelationshipType;
  bucket: LearnedRelationshipBucket;
}) {
  const hasData = bucket.count > 0;

  return (
    <Surface tone="mist" padded className="p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="ds-heading-sm" style={{ color: "var(--text-primary)" }}>
          {RELATIONSHIP_LABELS[type]}
        </h2>
        <span className="text-[11.5px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>
          {bucket.count.toLocaleString()} email{bucket.count === 1 ? "" : "s"}
        </span>
      </div>

      {!hasData ? (
        <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          No indexed examples for this relationship group yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-[0.14em]" style={{ color: "var(--text-tertiary)" }}>
                <th className="border-b pb-2 pr-4 font-semibold" style={{ borderColor: "var(--border)" }}>Part</th>
                <th className="border-b pb-2 pr-4 font-semibold" style={{ borderColor: "var(--border)" }}>Most common</th>
                <th className="border-b pb-2 pr-4 font-semibold" style={{ borderColor: "var(--border)" }}>Alternates</th>
                <th className="border-b pb-2 font-semibold" style={{ borderColor: "var(--border)" }}>What this means</th>
              </tr>
            </thead>
            <tbody className="text-[13px]" style={{ color: "var(--text-primary)" }}>
              <PatternRow
                label="Greeting"
                patterns={bucket.greetings}
                labels={OPENING_LABELS}
                interpretation={openingInterpretation(bucket.greetings[0]?.value)}
              />
              <PatternRow
                label="Closing"
                patterns={bucket.closings}
                labels={CLOSING_LABELS}
                interpretation={closingInterpretation(bucket.closings[0]?.value)}
              />
              <tr>
                <td className="border-b py-3 pr-4 font-medium" style={{ borderColor: "var(--border)" }}>Length</td>
                <td className="border-b py-3 pr-4 tabular-nums" style={{ borderColor: "var(--border)" }}>
                  {bucket.wordCountMedian} words
                </td>
                <td className="border-b py-3 pr-4 tabular-nums" style={{ borderColor: "var(--border)" }}>
                  {bucket.avgSentenceLen} words / sentence
                </td>
                <td className="border-b py-3" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                  {lengthInterpretation(bucket.wordCountMedian, bucket.avgSentenceLen)}
                </td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-medium">Signature phrases</td>
                <td className="py-3 pr-4">
                  {bucket.signaturePhrases[0]
                    ? quotePattern(bucket.signaturePhrases[0])
                    : "None recurring"}
                </td>
                <td className="py-3 pr-4">
                  {formatPatternAlternates(bucket.signaturePhrases.slice(1, 4))}
                </td>
                <td className="py-3" style={{ color: "var(--text-secondary)" }}>
                  Reuse sparingly when the message needs to sound more personal.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Surface>
  );
}

function PatternRow({
  label,
  patterns,
  labels,
  interpretation,
}: {
  label: string;
  patterns: PatternFreq<string>[];
  labels: Record<string, string>;
  interpretation: string;
}) {
  const primary = patterns[0];
  return (
    <tr>
      <td className="border-b py-3 pr-4 font-medium" style={{ borderColor: "var(--border)" }}>{label}</td>
      <td className="border-b py-3 pr-4" style={{ borderColor: "var(--border)" }}>
        {primary ? `${labels[primary.value] ?? primary.value} (${primary.pct}%)` : "No data"}
      </td>
      <td className="border-b py-3 pr-4" style={{ borderColor: "var(--border)" }}>
        {formatPatternAlternates(patterns.slice(1, 4), labels)}
      </td>
      <td className="border-b py-3" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
        {interpretation}
      </td>
    </tr>
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

function quotePattern(pattern: PatternFreq<string>): string {
  return `"${pattern.value}" x${pattern.count}`;
}

function formatPatternAlternates(
  patterns: PatternFreq<string>[],
  labels?: Record<string, string>,
): string {
  if (patterns.length === 0) return "None detected";
  return patterns
    .map((p) => {
      const value = labels?.[p.value] ?? p.value;
      return `${value} (${p.pct}%)`;
    })
    .join(", ");
}

function openingInterpretation(value: string | undefined): string {
  switch (value) {
    case "first_name":
      return "Lead with the person directly, without extra ceremony.";
    case "hey":
      return "Casual and familiar; works best for warm relationships.";
    case "hi":
    case "hello":
      return "Simple and direct; good default when unsure.";
    case "dear":
      return "More formal; reserve for structured or institutional notes.";
    case "none":
      return "Often skips the greeting and starts with substance.";
    default:
      return "Use the relationship context to choose the greeting.";
  }
}

function closingInterpretation(value: string | undefined): string {
  switch (value) {
    case "warmly":
      return "Warm, personal, and still professional.";
    case "best":
      return "Neutral, efficient, and broadly safe.";
    case "thanks":
    case "thank_you":
      return "Useful when asking for or acknowledging help.";
    case "cheers":
    case "talk_soon":
    case "xo":
      return "More familiar; use when the relationship is clearly warm.";
    case "none":
      return "Often ends cleanly without a signoff.";
    default:
      return "Match the closing to the ask and relationship warmth.";
  }
}

function lengthInterpretation(wordCountMedian: number, avgSentenceLen: number): string {
  if (wordCountMedian <= 45) return "Keep replies short and purposeful.";
  if (wordCountMedian >= 120) return "This group gets more context and explanation.";
  if (avgSentenceLen <= 12) return "Use crisp sentences and avoid long build-up.";
  return "Moderate length; include context without over-explaining.";
}
