import { describe, expect, it } from "vitest";
import {
  mergeVoiceReferenceRows,
  type VoiceReferenceCacheRow,
} from "@/lib/voice/reference-cache";

describe("mergeVoiceReferenceRows", () => {
  it("prepends new reference rows in newest-first order", () => {
    const merged = mergeVoiceReferenceRows(
      [
        referenceRow("old", "old.md", "2026-06-20T12:00:00.000Z"),
      ],
      [
        referenceRow("newer", "newer.md", "2026-06-29T12:00:00.000Z"),
        referenceRow("new", "new.md", "2026-06-28T12:00:00.000Z"),
      ],
    );

    expect(merged.map((row) => row.id)).toEqual(["newer", "new", "old"]);
  });

  it("dedupes incoming rows against existing cache rows", () => {
    const merged = mergeVoiceReferenceRows(
      [
        referenceRow("same", "existing.md", "2026-06-27T12:00:00.000Z"),
        referenceRow("old", "old.md", "2026-06-20T12:00:00.000Z"),
      ],
      [
        referenceRow("same", "updated.md", "2026-06-29T12:00:00.000Z"),
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      id: "same",
      filename: "updated.md",
    });
  });
});

function referenceRow(
  id: string,
  filename: string,
  addedAt: string,
): VoiceReferenceCacheRow {
  return {
    id,
    filename,
    sourceType: "gpt_knowledge_base",
    weight: 1,
    byteSize: 120,
    guidance: null,
    addedAt,
  };
}
