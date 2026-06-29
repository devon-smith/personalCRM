/**
 * VoiceReference upload pipeline (M0.x.5).
 *
 * One call per file. Orchestrates:
 *   1. Plain-text extraction (parser.ts)
 *   2. SHA-256 hash + dedup (skips silently if already imported)
 *   3. Voyage embedding (fail-soft — row is created without if Voyage is down)
 *   4. Haiku guidance extraction (fail-soft — empty guidance shape if down)
 *   5. INSERT VoiceReference row via raw SQL (pgvector column needs it)
 *
 * Returns a typed result so the API route can give the user a clear
 * "imported / skipped duplicate / failed" message per file.
 */

import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { embedBatch, formatVectorLiteral, VoyageError } from "@/lib/search/embeddings";
import { extractText, MAX_REFERENCE_TEXT_BYTES } from "./parser";
import { extractGuidance } from "./guidance";
import { logAIGeneration } from "@/lib/ai-generation-log";
import { GUIDANCE_MODEL } from "./guidance";

export type UploadOutcome =
  | { status: "imported"; id: string; filename: string; bytes: number; truncated: boolean }
  | { status: "duplicate"; filename: string }
  | { status: "failed"; filename: string; reason: string };

export interface UploadArgs {
  prisma: PrismaClient;
  userId: string;
  filename: string;
  buffer: Buffer;
  /** sourceType — defaults to "gpt_knowledge_base". The UI passes
   *  this when the user explicitly tags a file (book excerpt etc). */
  sourceType?: string;
}

export async function uploadVoiceReference(
  args: UploadArgs,
): Promise<UploadOutcome> {
  let parsed;
  try {
    parsed = await extractText(args.buffer, args.filename);
  } catch (err) {
    return {
      status: "failed",
      filename: args.filename,
      reason: err instanceof Error ? err.message : "Parse failed",
    };
  }

  const sourceType = args.sourceType ?? "gpt_knowledge_base";
  // Tier weight per spec: KB 1.0, other refs 0.3.
  const weight = sourceType === "gpt_knowledge_base" ? 1.0 : 0.3;

  const contentHash = createHash("sha256").update(parsed.text).digest("hex");

  // Dedup per user — re-upload of the same file is a no-op.
  const existing = await args.prisma.voiceReference.findUnique({
    where: { userId_contentHash: { userId: args.userId, contentHash } },
    select: { id: true },
  });
  if (existing) {
    return { status: "duplicate", filename: args.filename };
  }

  // Best-effort embedding. Voyage failures don't block the row —
  // wholesale text injection still happens at draft time.
  let embeddingLiteral: string | null = null;
  if (process.env.VOYAGE_API_KEY) {
    try {
      // Embed the first 8KB — Voyage's voyage-3-lite handles plenty
      // more, but for retrieval relevance the opening of a KB file
      // is usually most representative.
      const result = await embedBatch([parsed.text.slice(0, 8000)], "document", {
        userId: args.userId,
        feature: "voice_reference_upload",
        metadata: {
          filename: args.filename,
          sourceType: args.sourceType,
        },
      });
      if (result.embeddings.length > 0) {
        embeddingLiteral = formatVectorLiteral(result.embeddings[0]);
      }
    } catch (err) {
      if (err instanceof VoyageError) {
        console.warn(
          `[voice-references] Voyage failed for ${args.filename}: ${err.message}`,
        );
      }
      // Continue without embedding.
    }
  }

  // Haiku-extract structured guidance. Fail-soft inside extractGuidance —
  // empty shape on error, never throws.
  const guidance = await extractGuidance(parsed.text);

  // Use raw SQL to handle the pgvector column. Prisma doesn't natively
  // bind to vector types, so we go through $executeRaw with a string
  // literal cast. JSON column accepts the guidance object directly.
  const id = `vref_${cuid()}`;
  if (embeddingLiteral) {
    await args.prisma.$executeRaw`
      INSERT INTO "VoiceReference"
        ("id", "userId", "filename", "sourceType", "content", "contentHash",
         "weight", "byteSize", "guidance", "embedding", "addedAt")
      VALUES
        (${id}, ${args.userId}, ${args.filename}, ${sourceType},
         ${parsed.text}, ${contentHash}, ${weight}, ${args.buffer.byteLength},
         ${JSON.stringify({
           applicableRelationships: guidance.applicableRelationships,
           greetings: guidance.greetings,
           closings: guidance.closings,
           signaturePhrases: guidance.signaturePhrases,
           avoidPhrases: guidance.avoidPhrases,
           toneNotes: guidance.toneNotes,
         })}::jsonb,
         ${embeddingLiteral}::vector, NOW())
    `;
  } else {
    await args.prisma.$executeRaw`
      INSERT INTO "VoiceReference"
        ("id", "userId", "filename", "sourceType", "content", "contentHash",
         "weight", "byteSize", "guidance", "addedAt")
      VALUES
        (${id}, ${args.userId}, ${args.filename}, ${sourceType},
         ${parsed.text}, ${contentHash}, ${weight}, ${args.buffer.byteLength},
         ${JSON.stringify({
           applicableRelationships: guidance.applicableRelationships,
           greetings: guidance.greetings,
           closings: guidance.closings,
           signaturePhrases: guidance.signaturePhrases,
           avoidPhrases: guidance.avoidPhrases,
           toneNotes: guidance.toneNotes,
         })}::jsonb,
         NOW())
    `;
  }

  // Log the Haiku call for cost auditing. Best-effort.
  if (guidance.tokensIn !== undefined) {
    await logAIGeneration({
      userId: args.userId,
      feature: "voice_reference_guidance",
      model: GUIDANCE_MODEL,
      inputRefs: [`voiceReference:${id}`],
      outputId: id,
      tokensIn: guidance.tokensIn ?? null,
      tokensOut: guidance.tokensOut ?? null,
    });
  }

  return {
    status: "imported",
    id,
    filename: args.filename,
    bytes: parsed.text.length,
    truncated: parsed.truncated,
  };
}

// Tiny cuid generator inline — we control the prefix above and don't
// need cuid2's collision-free guarantees for a per-user table.
function cuid(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  );
}

export { MAX_REFERENCE_TEXT_BYTES };
