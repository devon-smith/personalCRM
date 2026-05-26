/**
 * Shared types for the iterative draft workspace (M0.x.6).
 *
 * The workspace persists state on the Draft row itself via two JSON
 * columns:
 *   - workspaceVersions  : ordered list of every generated version
 *   - refinementChat     : conversation log driving the iterations
 *
 * Keeping the source-of-truth shapes in one place means the workspace
 * UI, the SSE refinement endpoint, and the variants endpoint all
 * agree on what's stored. JSON columns are loose at the DB level, so
 * we validate on read with the helpers in this module rather than
 * trusting the shape.
 */

export type WorkspaceVersionSource =
  | "initial"
  | "refinement"
  | "manual_edit"
  | "variant_pick";

export interface WorkspaceVersion {
  /** Monotonic — version 1 is the initial generation. */
  readonly version: number;
  readonly content: string;
  readonly subjectLine: string | null;
  /** ISO-8601 timestamp when the version was created. */
  readonly generatedAt: string;
  /** What triggered this version (the chat request for refinements,
   *  "manual_edit" when the user typed into the editor, etc.) */
  readonly sourceRequest: string;
  readonly source: WorkspaceVersionSource;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
}

export type RefinementChatRole = "user" | "assistant";

export interface RefinementChatMessage {
  readonly role: RefinementChatRole;
  readonly content: string;
  /** ISO-8601 timestamp. */
  readonly timestamp: string;
  /** When the assistant message produced a new version, the version
   *  number it created. Lets the UI link chat turns to versions. */
  readonly versionId?: number;
}

/** Quick-action chips that prefill the refinement input. */
export const REFINEMENT_QUICK_ACTIONS = [
  { label: "Shorter", request: "Make this shorter — tighten without losing substance." },
  { label: "Warmer", request: "Warmer tone — more genuinely friendly, less businesslike." },
  { label: "More direct", request: "More direct. Cut hedging and qualifiers." },
  { label: "Add humor", request: "Add a touch of dry, well-placed humor — nothing forced." },
] as const;

// ─── Pure helpers (no I/O — testable in isolation) ──────────

export function parseVersions(raw: unknown): WorkspaceVersion[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkspaceVersion[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    if (typeof rec.version !== "number") continue;
    if (typeof rec.content !== "string") continue;
    out.push({
      version: rec.version,
      content: rec.content,
      subjectLine:
        typeof rec.subjectLine === "string" ? rec.subjectLine : null,
      generatedAt:
        typeof rec.generatedAt === "string" ? rec.generatedAt : new Date(0).toISOString(),
      sourceRequest:
        typeof rec.sourceRequest === "string" ? rec.sourceRequest : "unknown",
      source: isVersionSource(rec.source) ? rec.source : "refinement",
      tokensIn:
        typeof rec.tokensIn === "number" ? rec.tokensIn : undefined,
      tokensOut:
        typeof rec.tokensOut === "number" ? rec.tokensOut : undefined,
    });
  }
  return out.sort((a, b) => a.version - b.version);
}

function isVersionSource(v: unknown): v is WorkspaceVersionSource {
  return (
    v === "initial" ||
    v === "refinement" ||
    v === "manual_edit" ||
    v === "variant_pick"
  );
}

export function parseChat(raw: unknown): RefinementChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: RefinementChatMessage[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    if (rec.role !== "user" && rec.role !== "assistant") continue;
    if (typeof rec.content !== "string") continue;
    out.push({
      role: rec.role,
      content: rec.content,
      timestamp:
        typeof rec.timestamp === "string"
          ? rec.timestamp
          : new Date().toISOString(),
      versionId:
        typeof rec.versionId === "number" ? rec.versionId : undefined,
    });
  }
  return out;
}

/** Most recent version, or null if none exist. */
export function currentVersion(
  versions: ReadonlyArray<WorkspaceVersion>,
): WorkspaceVersion | null {
  if (versions.length === 0) return null;
  return versions[versions.length - 1];
}

/** Next version number — versions are 1-indexed, monotonic. */
export function nextVersionNumber(
  versions: ReadonlyArray<WorkspaceVersion>,
): number {
  if (versions.length === 0) return 1;
  return Math.max(...versions.map((v) => v.version)) + 1;
}
