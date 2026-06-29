import { prisma } from "@/lib/prisma";

export interface LogProviderCallInput {
  userId?: string | null;
  provider: string;
  service: string;
  operation: string;
  feature: string;
  model?: string | null;
  callCount?: number | null;
  itemCount?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  status?: "success" | "error";
  latencyMs?: number | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Durable telemetry for provider calls that are not LLM generations.
 * Never throws: usage logging must not break draft save/send, search,
 * embedding refresh, or other product flows.
 */
export async function logProviderCall(
  input: LogProviderCallInput,
): Promise<void> {
  try {
    await prisma.providerCallLog.create({
      data: {
        userId: input.userId ?? null,
        provider: input.provider,
        service: input.service,
        operation: input.operation,
        feature: input.feature,
        model: input.model ?? null,
        callCount: input.callCount ?? 1,
        itemCount: input.itemCount ?? null,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
        status: input.status ?? "success",
        latencyMs: input.latencyMs ?? null,
        error: input.error ? input.error.slice(0, 500) : null,
        metadata: input.metadata ? (input.metadata as object) : undefined,
      },
    });
  } catch (err) {
    console.error("ProviderCallLog write failed:", err);
  }
}
