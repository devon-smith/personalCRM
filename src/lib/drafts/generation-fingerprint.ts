import { createHash } from "node:crypto";

export const DRAFT_GENERATION_REUSE_MS = 30 * 60 * 1000;

export interface DraftGenerationFingerprintInput {
  surface: "composer" | "workspace";
  contactId: string;
  tone: string;
  context: string;
  contextDetail?: string | null;
  threadSubject?: string | null;
  threadSnippet?: string | null;
  threadKey?: string | null;
  variant?: string | null;
  relationshipTypeOverride?: string | null;
}

export function buildDraftGenerationFingerprint(
  input: DraftGenerationFingerprintInput,
): string {
  const payload = {
    v: 1,
    surface: input.surface,
    contactId: input.contactId,
    tone: input.tone,
    context: input.context,
    contextDetail: normalize(input.contextDetail),
    threadSubject: normalize(input.threadSubject),
    threadSnippet: normalize(input.threadSnippet),
    threadKey: normalize(input.threadKey),
    variant: normalize(input.variant),
    relationshipTypeOverride: normalize(input.relationshipTypeOverride),
  };

  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || null;
}
