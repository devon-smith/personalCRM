import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@/test/helpers";
import {
  transcribeAudio,
  TranscriptionError,
  MAX_UPLOAD_BYTES,
} from "@/lib/transcription";

describe("transcribeAudio", () => {
  const origFetch = globalThis.fetch;
  const origKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    process.env.OPENAI_API_KEY = origKey;
    vi.clearAllMocks();
  });

  it("throws when OPENAI_API_KEY is unset", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(
      transcribeAudio({
        audio: new Blob(["fake"], { type: "audio/webm" }),
        filename: "x.webm",
      }),
    ).rejects.toMatchObject({ name: "TranscriptionError" });
  });

  it("rejects oversize audio without calling the API", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as never;

    const huge = new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type: "audio/webm" });
    await expect(
      transcribeAudio({ audio: huge, filename: "huge.webm" }),
    ).rejects.toThrow(/too large/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parses text + duration from Whisper's verbose_json response", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ text: "  Reach out to Marc next week.  ", duration: 8.7 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as never;

    const result = await transcribeAudio({
      audio: new Blob(["fake"], { type: "audio/webm" }),
      filename: "memo.webm",
    });
    expect(result.text).toBe("Reach out to Marc next week.");
    expect(result.durationSec).toBe(9);
  });

  it("returns retryable=true on 429 and 5xx", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("rate limited", { status: 429 }),
    ) as never;

    try {
      await transcribeAudio({
        audio: new Blob(["x"]),
        filename: "x.webm",
      });
      throw new Error("Expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TranscriptionError);
      expect((err as TranscriptionError).status).toBe(429);
      expect((err as TranscriptionError).retryable).toBe(true);
    }
  });

  it("returns retryable=false on 400", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("bad audio", { status: 400 }),
    ) as never;

    try {
      await transcribeAudio({
        audio: new Blob(["x"]),
        filename: "x.webm",
      });
      throw new Error("Expected to throw");
    } catch (err) {
      expect((err as TranscriptionError).status).toBe(400);
      expect((err as TranscriptionError).retryable).toBe(false);
    }
  });

  it("sends the contact-name prompt to Whisper when provided", async () => {
    let captured: FormData | undefined;
    globalThis.fetch = vi.fn(async (_url, init: RequestInit | undefined) => {
      captured = init?.body as FormData;
      return new Response(JSON.stringify({ text: "hi", duration: 1 }), { status: 200 });
    }) as never;

    await transcribeAudio({
      audio: new Blob(["x"]),
      filename: "x.webm",
      prompt: "Jennifer Aaker",
    });
    expect(captured?.get("prompt")).toBe("Jennifer Aaker");
    expect(captured?.get("model")).toBe("whisper-1");
    expect(captured?.get("response_format")).toBe("verbose_json");
  });
});
