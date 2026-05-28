"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Loader2, X, Sparkles, Save } from "lucide-react";
import { toast } from "sonner";
import { Surface, SectionLabel, Pill, Sparkline } from "@/components/ds";
import type {
  LearnedProfile,
  LearnedRelationshipBucket,
  PatternFreq,
  VoiceOverrides,
} from "@/lib/voice/profile";
import type { RelationshipType } from "@/lib/voice/relationship-classifier";

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

export default function VoiceSettingsPage() {
  const qc = useQueryClient();

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

  const removePhrase = useMutation({
    mutationFn: async (phrase: string) => {
      const res = await fetch("/api/voice/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removedPhrases: [phrase] }),
      });
      if (!res.ok) throw new Error("Failed to remove phrase");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["voice", "profile"] });
      toast.success("Removed — won't reappear on re-index");
    },
    onError: () => toast.error("Failed to remove phrase"),
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

  return (
    <div className="crm-stagger space-y-8 pt-14">
      <div>
        <h1 className="ds-display-xl">Your voice</h1>
        <p
          className="ds-body-lg mt-3 max-w-[640px]"
          style={{ color: "#5A574F" }}
        >
          What we&apos;ve learned from your sent mail. Drafts use these patterns
          so they sound like you. Remove anything that doesn&apos;t — overrides
          stick across re-indexing.
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
          {/* M0.x.5: link to the reference uploads page. Refs
              dominate over learned email patterns at draft time. */}
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
            Reference materials →
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

      {/* Per-relationship cards */}
      {profile && profile.learned.overallCount > 0 ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {(Object.entries(profile.learned.byRelationship) as Array<
            [RelationshipType, LearnedRelationshipBucket]
          >)
            .filter(([, bucket]) => bucket.count > 0)
            .sort(([, a], [, b]) => b.count - a.count)
            .map(([type, bucket]) => (
              <RelationshipCard
                key={type}
                type={type}
                bucket={bucket}
                onRemovePhrase={(phrase) => removePhrase.mutate(phrase)}
              />
            ))}
        </div>
      ) : (
        !profileLoading && (
          <Surface tone="sand" padded>
            <p className="ds-body-md" style={{ color: "#1B1A17" }}>
              Click <strong>Re-index now</strong> to pull your sent mail and
              build a voice fingerprint. First pass takes 2–5 minutes.
            </p>
          </Surface>
        )
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

// ─── Relationship card ─────────────────────────────────────

function RelationshipCard({
  type,
  bucket,
  onRemovePhrase,
}: {
  type: RelationshipType;
  bucket: LearnedRelationshipBucket;
  onRemovePhrase: (phrase: string) => void;
}) {
  const sparklineData =
    bucket.greetings.length > 0
      ? bucket.greetings.map((g) => g.count)
      : [1];

  return (
    <Surface tone="mist" padded className="p-6">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h2 className="ds-display-md" style={{ fontSize: "1.25rem" }}>
          {RELATIONSHIP_LABELS[type]}
        </h2>
        <span
          className="text-[11.5px] tabular-nums"
          style={{ color: "#8C8A82" }}
        >
          {bucket.count} emails
        </span>
      </div>

      {/* Greetings */}
      <div className="mb-4">
        <SectionLabel>Greetings</SectionLabel>
        <PatternList
          patterns={bucket.greetings}
          labels={OPENING_LABELS}
          maxItems={4}
        />
      </div>

      {/* Closings */}
      <div className="mb-4">
        <SectionLabel>Closings</SectionLabel>
        <PatternList
          patterns={bucket.closings}
          labels={CLOSING_LABELS}
          maxItems={4}
        />
      </div>

      {/* Rhythm */}
      <div className="mb-4 flex items-center gap-6">
        <div>
          <SectionLabel>Avg sentence</SectionLabel>
          <div
            className="text-[15px] font-semibold tabular-nums mt-1"
            style={{ color: "#1B1A17" }}
          >
            {bucket.avgSentenceLen} words
          </div>
        </div>
        <div>
          <SectionLabel>Typical length</SectionLabel>
          <div
            className="text-[15px] font-semibold tabular-nums mt-1"
            style={{ color: "#1B1A17" }}
          >
            {bucket.wordCountMedian} words
          </div>
        </div>
        <div className="ml-auto">
          <Sparkline data={sparklineData} variant="bars" width={56} height={24} />
        </div>
      </div>

      {/* Signature phrases */}
      <div>
        <SectionLabel>Signature phrases</SectionLabel>
        {bucket.signaturePhrases.length === 0 ? (
          <p
            className="ds-body-sm mt-1.5"
            style={{ color: "#8C8A82" }}
          >
            None recurring yet. Need more emails to detect patterns.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {bucket.signaturePhrases.slice(0, 12).map((phrase) => (
              <span
                key={phrase.value}
                className="group inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium"
                style={{ backgroundColor: "#EFEAE0", color: "#5A574F" }}
              >
                &ldquo;{phrase.value}&rdquo;
                <span
                  className="text-[10px] tabular-nums"
                  style={{ color: "#8C8A82" }}
                >
                  ×{phrase.count}
                </span>
                <button
                  onClick={() => onRemovePhrase(phrase.value)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: "#8C8A82" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#7A4F3C";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#8C8A82";
                  }}
                  aria-label="Remove phrase"
                  title="Remove — won't reappear on re-index"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </Surface>
  );
}

function PatternList({
  patterns,
  labels,
  maxItems,
}: {
  patterns: PatternFreq<string>[];
  labels: Record<string, string>;
  maxItems: number;
}) {
  if (patterns.length === 0) {
    return (
      <p className="ds-body-sm mt-1.5" style={{ color: "#8C8A82" }}>
        No data yet
      </p>
    );
  }
  return (
    <div className="mt-1.5 space-y-1">
      {patterns.slice(0, maxItems).map((p) => (
        <div
          key={p.value}
          className="flex items-baseline justify-between text-[13px]"
        >
          <span style={{ color: "#1B1A17" }}>
            {labels[p.value] ?? p.value}
          </span>
          <span
            className="tabular-nums"
            style={{ color: "#8C8A82" }}
          >
            {p.pct}%
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────

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
