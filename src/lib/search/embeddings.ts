/**
 * Voyage AI embeddings for semantic contact search.
 *
 * - Model: voyage-3-lite (512 dim, $0.02/1M tokens — cheapest tier,
 *   plenty for short contact-card text).
 * - Input types: "document" for stored contacts, "query" for the
 *   user's search string. Voyage's documentation strongly recommends
 *   this asymmetry; it materially improves recall.
 * - Batch limit: 128 texts per request.
 *
 * Requires VOYAGE_API_KEY in the environment. The wrapping fetch
 * surfaces a structured error so the backfill script can decide
 * whether to retry or bail.
 */
import { logProviderCall } from "../provider-call-log";

const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3-lite";

export const EMBEDDING_DIM = 512;
export const MAX_BATCH_SIZE = 128;

export type VoyageInputType = "document" | "query";

export interface EmbedBatchTelemetry {
  userId?: string | null;
  feature: string;
  metadata?: Record<string, unknown>;
}

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
}

export class VoyageError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "VoyageError";
  }
}

/**
 * Embed a batch of texts. Order of return matches order of input.
 * Throws VoyageError on any failure with a retryable flag set for
 * 5xx / 429 / network errors.
 */
export async function embedBatch(
  texts: string[],
  inputType: VoyageInputType,
  telemetry?: EmbedBatchTelemetry,
): Promise<{ embeddings: number[][]; tokens: number }> {
  if (texts.length === 0) return { embeddings: [], tokens: 0 };
  if (texts.length > MAX_BATCH_SIZE) {
    throw new VoyageError(`Batch size ${texts.length} exceeds limit ${MAX_BATCH_SIZE}`);
  }

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new VoyageError("VOYAGE_API_KEY not set");
  }

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(VOYAGE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: texts,
        input_type: inputType,
      }),
    });
  } catch (err) {
    await logVoyageEmbeddingCall({
      telemetry,
      inputType,
      textCount: texts.length,
      status: "error",
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : "network error",
    });
    throw new VoyageError(
      err instanceof Error ? err.message : "network error",
      undefined,
      true,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    await logVoyageEmbeddingCall({
      telemetry,
      inputType,
      textCount: texts.length,
      status: "error",
      latencyMs: Date.now() - startedAt,
      error: `Voyage API ${res.status}: ${body.slice(0, 200)}`,
    });
    throw new VoyageError(
      `Voyage API ${res.status}: ${body.slice(0, 200)}`,
      res.status,
      retryable,
    );
  }

  const data = (await res.json()) as VoyageResponse;
  // Voyage returns objects with an index field; sort to guarantee order.
  const ordered = [...data.data].sort((a, b) => a.index - b.index);
  await logVoyageEmbeddingCall({
    telemetry,
    inputType,
    textCount: texts.length,
    status: "success",
    latencyMs: Date.now() - startedAt,
    tokensIn: data.usage.total_tokens,
    model: data.model || VOYAGE_MODEL,
  });
  return {
    embeddings: ordered.map((e) => e.embedding),
    tokens: data.usage.total_tokens,
  };
}

async function logVoyageEmbeddingCall(input: {
  telemetry?: EmbedBatchTelemetry;
  inputType: VoyageInputType;
  textCount: number;
  status: "success" | "error";
  latencyMs: number;
  tokensIn?: number;
  model?: string;
  error?: string;
}) {
  if (!input.telemetry?.feature) return;
  await logProviderCall({
    userId: input.telemetry.userId,
    provider: "voyage",
    service: "embeddings",
    operation: "voyage.embeddings.create",
    feature: input.telemetry.feature,
    model: input.model ?? VOYAGE_MODEL,
    callCount: 1,
    itemCount: input.textCount,
    tokensIn: input.tokensIn ?? null,
    tokensOut: 0,
    status: input.status,
    latencyMs: input.latencyMs,
    error: input.error,
    metadata: {
      inputType: input.inputType,
      ...input.telemetry.metadata,
    },
  });
}

/**
 * Build the input string we embed for a contact. The shape matters more
 * than the exact prose — Voyage's embedding space rewards descriptive
 * contextual phrasing. Empty fields are dropped so we don't waste tokens
 * on "X works as null at null".
 */
export interface ContactEmbedInput {
  name: string;
  email?: string | null;
  role?: string | null;
  company?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  circleNames?: string[];
}

export function buildContactEmbedText(c: ContactEmbedInput): string {
  const lines: string[] = [c.name];

  const roleLine = [c.role, c.company && `at ${c.company}`].filter(Boolean).join(" ");
  if (roleLine) lines.push(roleLine);

  const location = [c.city, c.state, c.country].filter(Boolean).join(", ");
  if (location) lines.push(`Based in ${location}`);

  if (c.circleNames && c.circleNames.length > 0) {
    lines.push(`Circles: ${c.circleNames.join(", ")}`);
  }

  if (c.email) lines.push(c.email);

  return lines.join("\n");
}

/**
 * Format an embedding as a pgvector literal: `[0.1,0.2,...]` (no spaces).
 * Used in raw SQL since Prisma can't bind vector parameters directly.
 */
export function formatVectorLiteral(embedding: number[]): string {
  return "[" + embedding.join(",") + "]";
}
