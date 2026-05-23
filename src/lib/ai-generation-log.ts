import { prisma } from "@/lib/prisma";

export interface LogAIGenerationInput {
  userId: string;
  feature: string;
  model: string;
  inputRefs?: string[];
  outputId?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  cacheHit?: boolean | null;
  latencyMs?: number | null;
  error?: string | null;
}

/**
 * Write one row to AIGenerationLog. Never throws — logging must not break
 * the caller. Callers pass `inputRefs` so the evidence chevron can later
 * answer "what did this draft draw from?" without re-reading the prompt.
 */
export async function logAIGeneration(input: LogAIGenerationInput): Promise<void> {
  try {
    await prisma.aIGenerationLog.create({
      data: {
        userId: input.userId,
        feature: input.feature,
        model: input.model,
        inputRefs: input.inputRefs as unknown as object | undefined,
        outputId: input.outputId ?? null,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
        cacheHit: input.cacheHit ?? null,
        latencyMs: input.latencyMs ?? null,
        error: input.error ?? null,
      },
    });
  } catch (err) {
    console.error("AIGenerationLog write failed:", err);
  }
}
