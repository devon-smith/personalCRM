export interface VoiceReferenceCacheRow {
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

export function mergeVoiceReferenceRows(
  current: VoiceReferenceCacheRow[] | undefined,
  incoming: VoiceReferenceCacheRow[],
) {
  if (!current) return incoming;
  if (incoming.length === 0) return current;

  const incomingIds = new Set(incoming.map((row) => row.id));
  return [
    ...incoming,
    ...current.filter((row) => !incomingIds.has(row.id)),
  ].sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt));
}
