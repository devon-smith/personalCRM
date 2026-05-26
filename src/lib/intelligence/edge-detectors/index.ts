/**
 * Edge-detector module (M7.2).
 *
 * Each detector turns observed signals (shared threads, same-org
 * heuristics, named mentions) into ContactEdge rows. Detectors are
 * pure functions that return edge proposals — the worker handles
 * dedup, upsert, and ordering canonicalization.
 *
 * Adding a new detector: implement EdgeDetector, register in
 * `worker/tasks/graph-edge-extraction.ts`. Each detector decides its
 * own incremental window (e.g., mutual-thread only re-scans threads
 * with activity since the last run).
 */

export interface EdgeProposal {
  /** Contact IDs in arbitrary order — caller canonicalizes (from < to). */
  contactA: string;
  contactB: string;
  edgeType: string;
  /** 0-1. Detectors return their own strength; on conflict in the DB,
   *  the worker keeps the max (a stronger signal supersedes a weaker
   *  earlier observation). */
  strength: number;
  /** Source-record refs for provenance. Schema is per-edgeType:
   *  - mutual_thread: { threadId, source, lastActivityAt }
   *  - same_org: { signal: "company"|"email_domain", value }
   */
  evidence: Record<string, unknown>;
}

export { detectMutualThreadEdges } from "./mutual-thread";
export { detectSameOrgEdges } from "./same-org";
export { detectIntroducedEdges } from "./introduced";
