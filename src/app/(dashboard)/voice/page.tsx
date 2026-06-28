"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Surface, SectionLabel, Pill } from "@/components/ds";
import type { LearnedProfile, VoiceOverrides } from "@/lib/voice/profile";

interface ProfileResponse {
  learned: LearnedProfile;
  overrides: VoiceOverrides;
  indexedEmailCount: number;
  lastIndexedAt: string | null;
  userInstructions: string | null;
}

interface StatsResponse {
  indexedEmailCount: number;
  oldestIndexedAt: string | null;
  newestIndexedAt: string | null;
  lastIndexedAt: string | null;
  countsByType: Record<string, number>;
}

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

export default function VoiceSettingsPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sourceType, setSourceType] = useState("gpt_knowledge_base");
  const [lastOutcomes, setLastOutcomes] = useState<UploadOutcome[] | null>(null);

  const { data: profile, isLoading: profileLoading } = useQuery<ProfileResponse>({
    queryKey: ["voice", "profile"],
    queryFn: async () => {
      const res = await fetch("/api/voice/profile");
      if (!res.ok) throw new Error("Failed to load voice profile");
      return res.json();
    },
  });

  const { data: stats } = useQuery<StatsResponse>({
    queryKey: ["voice", "stats"],
    queryFn: async () => {
      const res = await fetch("/api/voice/stats");
      if (!res.ok) throw new Error("Failed to load voice stats");
      return res.json();
    },
  });

  const reindex = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/voice/reindex", { method: "POST" });
      if (!res.ok) throw new Error("Reindex failed to enqueue");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Reindex queued — refresh in a minute to see updates");
    },
    onError: () => toast.error("Failed to queue reindex"),
  });

  const { data: referenceData, isLoading: referencesLoading } = useQuery<{
    references: VoiceReferenceRow[];
  }>({
    queryKey: ["voice-references"],
    queryFn: async () => {
      const res = await fetch("/api/voice/references");
      if (!res.ok) throw new Error("Failed to load references");
      return res.json();
    },
  });

  const uploadReference = useMutation({
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

  const removeReference = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/voice/references/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["voice-references"] });
      toast.success("Reference removed");
    },
    onError: () => toast.error("Couldn't remove reference"),
  });

  // M0.x.12 — save the free-form custom voice instructions.
  const saveInstructions = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch("/api/voice/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userInstructions: text }),
      });
      if (!res.ok) throw new Error("Failed to save voice instructions");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["voice", "profile"] });
      toast.success("Voice instructions saved — applied to every draft now");
    },
    onError: () => toast.error("Failed to save voice instructions"),
  });

  const handleFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files || files.length === 0) return;
      uploadReference.mutate(files);
    },
    [uploadReference],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const refs = referenceData?.references ?? [];

  return (
    <div className="crm-stagger space-y-8 pt-14">
      <div>
        <h1 className="ds-display-xl">Your voice</h1>
        <p
          className="ds-body-lg mt-3 max-w-[640px]"
          style={{ color: "#5A574F" }}
        >
          Curate the source material that teaches drafts how you write:
          direct instructions, your sent-mail corpus, and uploaded references
          that describe the voice you want to use.
        </p>
      </div>

      {/* Header strip */}
      <Surface tone="plain" padded className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <SectionLabel>Corpus</SectionLabel>
          <div className="ds-body-md mt-1" style={{ color: "#1B1A17" }}>
            {profileLoading ? (
              <span style={{ color: "#8C8A82" }}>Loading…</span>
            ) : stats && stats.indexedEmailCount > 0 ? (
              <>
                <span className="font-semibold tabular-nums">
                  {stats.indexedEmailCount.toLocaleString()}
                </span>{" "}
                emails indexed
                {stats.oldestIndexedAt && stats.newestIndexedAt && (
                  <span style={{ color: "#5A574F" }}>
                    {" · "}
                    {formatDateRange(stats.oldestIndexedAt, stats.newestIndexedAt)}
                  </span>
                )}
                {stats.lastIndexedAt && (
                  <span style={{ color: "#8C8A82" }} className="ds-body-sm">
                    {" · last refresh "}
                    {formatRelative(stats.lastIndexedAt)}
                  </span>
                )}
              </>
            ) : (
              <span style={{ color: "#8C8A82" }}>
                No corpus yet — run the first index.
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
          <Pill
            variant="outline"
            tone="accent"
            size="md"
            disabled={reindex.isPending}
            onClick={() => reindex.mutate()}
            leadingIcon={
              reindex.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )
            }
          >
            {reindex.isPending ? "Queuing…" : "Re-index now"}
          </Pill>
          {/* M0.x.5: refs dominate over learned email patterns at draft time. */}
          <Link
            href="/voice/references"
            className="inline-flex items-center justify-center rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--accent-soft)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            Manage references →
          </Link>
        </div>
      </Surface>

      {/* M0.x.12 — Custom voice instructions textarea. Applied to
          every outbound message (drafts, refinements, variants) as
          highest-priority guidance. */}
      <CustomInstructionsCard
        value={profile?.userInstructions ?? null}
        onSave={(text) => saveInstructions.mutate(text)}
        saving={saveInstructions.isPending}
      />

      <ReferenceMaterialsSection
        refs={refs}
        isLoading={referencesLoading}
        isDragging={isDragging}
        sourceType={sourceType}
        lastOutcomes={lastOutcomes}
        uploading={uploadReference.isPending}
        removing={removeReference.isPending}
        fileInputRef={fileInputRef}
        onSourceTypeChange={setSourceType}
        onDragOver={() => setIsDragging(true)}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onFiles={handleFiles}
        onRemove={(id) => removeReference.mutate(id)}
      />

      {!profileLoading && (!profile || profile.learned.overallCount === 0) && (
        <Surface tone="sand" padded>
          <p className="ds-body-md" style={{ color: "#1B1A17" }}>
            Click <strong>Re-index now</strong> to pull your sent mail and
            build a voice fingerprint. First pass takes 2–5 minutes.
          </p>
        </Surface>
      )}

      {/* Never says */}
      {profile && profile.learned.neverSays.length > 0 && (
        <Surface tone="stone" padded>
          <SectionLabel>You never say</SectionLabel>
          <p
            className="ds-body-sm mt-1.5"
            style={{ color: "#5A574F" }}
          >
            Stock phrases that don&apos;t show up in your sent mail. Drafts
            will avoid them.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {profile.learned.neverSays.map((phrase) => (
              <span
                key={phrase}
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: "#E4E9E9", color: "#5A574F" }}
              >
                &ldquo;{phrase}&rdquo;
              </span>
            ))}
          </div>
        </Surface>
      )}
    </div>
  );
}

// ─── Reference materials ───────────────────────────────────

function ReferenceMaterialsSection({
  refs,
  isLoading,
  isDragging,
  sourceType,
  lastOutcomes,
  uploading,
  removing,
  fileInputRef,
  onSourceTypeChange,
  onDragOver,
  onDragLeave,
  onDrop,
  onFiles,
  onRemove,
}: {
  refs: VoiceReferenceRow[];
  isLoading: boolean;
  isDragging: boolean;
  sourceType: string;
  lastOutcomes: UploadOutcome[] | null;
  uploading: boolean;
  removing: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onSourceTypeChange: (sourceType: string) => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLLabelElement>) => void;
  onFiles: (files: FileList | File[] | null) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Surface tone="plain" padded className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <SectionLabel>Reference material</SectionLabel>
          <h2 className="ds-display-md mt-1" style={{ color: "#1B1A17" }}>
            Uploaded writing guidance
          </h2>
          <p className="ds-body-sm mt-1 max-w-[620px]" style={{ color: "#5A574F" }}>
            Upload knowledge-base exports, style guides, book excerpts, or
            writing samples that capture how you want drafts to sound. These
            references override learned email patterns when drafts are generated.
          </p>
        </div>
        <Link
          href="/voice/references"
          className="inline-flex items-center justify-center rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
          style={{
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          Full reference library →
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel>Tag uploads as</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onSourceTypeChange(value)}
              className="inline-flex items-center rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors"
              style={{
                backgroundColor:
                  sourceType === value ? "var(--surface-sunken)" : "transparent",
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

      <label
        htmlFor="voice-reference-file-input"
        onDragOver={(event) => {
          event.preventDefault();
          onDragOver();
        }}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className="block rounded-2xl border-2 border-dashed px-6 py-9 text-center cursor-pointer transition-colors"
        style={{
          borderColor: isDragging ? "var(--accent-color)" : "var(--border)",
          backgroundColor: isDragging
            ? "var(--accent-soft)"
            : "var(--surface-sunken)",
        }}
      >
        <input
          ref={fileInputRef}
          id="voice-reference-file-input"
          type="file"
          multiple
          accept={ACCEPTED_EXT}
          className="sr-only"
          onChange={(event) => {
            onFiles(event.target.files);
            event.target.value = "";
          }}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "#8C8A82" }} />
            <p className="text-[13px]" style={{ color: "#5A574F" }}>
              Uploading, extracting text, and summarizing…
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: "var(--accent-soft)" }}
            >
              <Upload className="h-5 w-5" style={{ color: "var(--accent-color)" }} />
            </div>
            <p className="text-[14px] font-medium" style={{ color: "#1B1A17" }}>
              Drop files here or click to pick
            </p>
            <p className="text-[12px]" style={{ color: "#8C8A82" }}>
              .txt · .md · .pdf · .docx — multiple files supported
            </p>
          </div>
        )}
      </label>

      {lastOutcomes && lastOutcomes.length > 0 && (
        <Surface tone="sand" padded>
          <SectionLabel>Last upload</SectionLabel>
          <div className="mt-2 space-y-1">
            {lastOutcomes.map((outcome, index) => (
              <UploadOutcomeRow key={`${outcome.filename}-${index}`} outcome={outcome} />
            ))}
          </div>
        </Surface>
      )}

      <div>
        <SectionLabel>Your references ({refs.length})</SectionLabel>
        {isLoading ? (
          <div className="py-8 text-center">
            <Loader2 className="h-4 w-4 animate-spin mx-auto" style={{ color: "#8C8A82" }} />
          </div>
        ) : refs.length === 0 ? (
          <p className="ds-body-sm mt-2" style={{ color: "#8C8A82" }}>
            No references yet. Upload your custom GPT knowledge-base files or
            style guides here so generated drafts inherit that guidance.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {refs.map((row) => (
              <ReferenceRow
                key={row.id}
                row={row}
                onRemove={() => onRemove(row.id)}
                removing={removing}
              />
            ))}
          </div>
        )}
      </div>
    </Surface>
  );
}

function UploadOutcomeRow({ outcome }: { outcome: UploadOutcome }) {
  const Icon =
    outcome.status === "imported"
      ? CheckCircle2
      : outcome.status === "duplicate"
        ? Sparkles
        : AlertCircle;
  const color =
    outcome.status === "imported"
      ? "#6B8A6E"
      : outcome.status === "duplicate"
        ? "var(--text-tertiary)"
        : "var(--status-urgent, #DC2626)";

  return (
    <div className="flex items-start gap-2 text-[12.5px]" style={{ color: "#5A574F" }}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color }} />
      <span className="min-w-0 truncate">
        <span className="font-medium">{outcome.filename}</span>
        {outcome.status === "imported" && outcome.truncated && (
          <span style={{ color: "#8C8A82" }}> · truncated to fit</span>
        )}
        {outcome.status === "duplicate" && (
          <span style={{ color: "#8C8A82" }}> · already on file</span>
        )}
        {outcome.status === "failed" && outcome.reason && (
          <span style={{ color: "#8C8A82" }}> · {outcome.reason}</span>
        )}
      </span>
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
  const guidance = row.guidance;
  const hasGuidance =
    !!guidance &&
    ((guidance.greetings?.length ?? 0) > 0 ||
      (guidance.closings?.length ?? 0) > 0 ||
      (guidance.signaturePhrases?.length ?? 0) > 0 ||
      (guidance.avoidPhrases?.length ?? 0) > 0 ||
      (guidance.toneNotes ?? "").length > 0);

  return (
    <Surface tone="mist" padded>
      <div className="flex items-start gap-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: "var(--surface-sunken)" }}
        >
          <FileText className="h-4 w-4" style={{ color: "#8C8A82" }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="ds-body-sm truncate font-medium" style={{ color: "#1B1A17" }}>
              {row.filename}
            </p>
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium"
              style={{ backgroundColor: "var(--surface)", color: "#8C8A82" }}
            >
              {sourceLabel}
            </span>
            <span className="text-[11px] tabular-nums" style={{ color: "#8C8A82" }}>
              weight {row.weight.toFixed(1)} · {formatBytes(row.byteSize)}
            </span>
          </div>
          {guidance?.toneNotes && (
            <p className="mt-1 text-[12px] leading-[1.45]" style={{ color: "#5A574F" }}>
              {guidance.toneNotes}
            </p>
          )}
          {hasGuidance && (
            <button
              type="button"
              onClick={() => setShowGuidance((value) => !value)}
              className="mt-1.5 text-[11.5px]"
              style={{ color: "#8C8A82" }}
            >
              {showGuidance ? "Hide guidance ↑" : "Show extracted guidance ↓"}
            </button>
          )}
          {showGuidance && guidance && (
            <div className="mt-2 space-y-1.5 text-[12px]" style={{ color: "#5A574F" }}>
              {(guidance.greetings?.length ?? 0) > 0 && (
                <div>
                  <strong>Greetings:</strong>{" "}
                  {guidance.greetings!.map((item) => `"${item}"`).join(", ")}
                </div>
              )}
              {(guidance.closings?.length ?? 0) > 0 && (
                <div>
                  <strong>Closings:</strong>{" "}
                  {guidance.closings!.map((item) => `"${item}"`).join(", ")}
                </div>
              )}
              {(guidance.signaturePhrases?.length ?? 0) > 0 && (
                <div>
                  <strong>Signature phrases:</strong>
                  <ul className="list-disc pl-5">
                    {guidance.signaturePhrases!.map((item) => (
                      <li key={item}>&ldquo;{item}&rdquo;</li>
                    ))}
                  </ul>
                </div>
              )}
              {(guidance.avoidPhrases?.length ?? 0) > 0 && (
                <div>
                  <strong>Avoid:</strong>{" "}
                  {guidance.avoidPhrases!.map((item) => `"${item}"`).join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          className="rounded-[10px] p-1.5 transition-colors disabled:opacity-50"
          style={{ color: "#8C8A82" }}
          title="Remove this reference"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </Surface>
  );
}

// ─── Helpers ────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDateRange(oldestIso: string, newestIso: string): string {
  const oldest = new Date(oldestIso);
  const newest = new Date(newestIso);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return `${fmt(oldest)} – ${fmt(newest)}`;
}

const USER_INSTRUCTIONS_MAX = 4000;

/**
 * M0.x.12 — free-form custom voice instructions textarea. Whatever
 * Jennifer types here is prepended as the highest-priority block in
 * every outbound message Claude generates (drafts, workspace
 * refinements, variants). Complements the file-based references.
 */
function CustomInstructionsCard({
  value,
  onSave,
  saving,
}: {
  value: string | null;
  onSave: (text: string) => void;
  saving: boolean;
}) {
  const [text, setText] = useState<string>(value ?? "");
  // Sync local edits with server-side updates (e.g. another tab saves).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(value ?? "");
  }, [value]);
  const dirty = text !== (value ?? "");
  const overLimit = text.length > USER_INSTRUCTIONS_MAX;

  return (
    <div
      className="crm-card crm-animate-enter rounded-[var(--radius-md)] px-4 py-4"
      style={{
        backgroundColor: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="ds-heading-sm" style={{ color: "var(--text-primary)" }}>
            Custom voice instructions
          </p>
          <p
            className="ds-caption mt-0.5"
            style={{ color: "var(--text-tertiary)" }}
          >
            Anything you want Claude to remember about how you write. Applied
            to every draft, refinement, and variant — above references and
            learned patterns.
          </p>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          'e.g. "Always warm but direct — no corporate filler.\n' +
          'Never use \'circle back\' or \'just wanted to\'.\n' +
          'For casual notes, skip the greeting and dive in."'
        }
        rows={6}
        className="w-full rounded-[var(--radius-sm)] border px-3 py-2 text-[13px] font-mono resize-y"
        style={{
          borderColor: overLimit
            ? "var(--status-urgent, #DC2626)"
            : "var(--border)",
          backgroundColor: "var(--surface-sunken)",
          color: "var(--text-primary)",
          lineHeight: 1.5,
        }}
      />

      <div className="mt-2 flex items-center justify-between">
        <span
          className="ds-caption tabular-nums"
          style={{
            color: overLimit
              ? "var(--status-urgent, #DC2626)"
              : "var(--text-tertiary)",
          }}
        >
          {text.length.toLocaleString()} / {USER_INSTRUCTIONS_MAX.toLocaleString()}
        </span>
        <button
          onClick={() => onSave(text)}
          disabled={!dirty || saving || overLimit}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
          style={{
            backgroundColor:
              dirty && !overLimit
                ? "var(--accent-color)"
                : "var(--surface-sunken)",
            color:
              dirty && !overLimit
                ? "var(--text-inverse)"
                : "var(--text-tertiary)",
            border: "1px solid var(--border)",
          }}
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Save className="h-3 w-3" />
          )}
          {saving ? "Saving…" : "Save instructions"}
        </button>
      </div>
    </div>
  );
}
