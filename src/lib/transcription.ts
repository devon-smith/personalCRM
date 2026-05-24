/**
 * OpenAI Whisper transcription client.
 *
 * Voice memos are short — under a minute most of the time — so we
 * upload the full file in one request. Whisper supports up to 25 MB
 * which is roughly 25 minutes of compressed audio at typical phone
 * quality, well past anything we'd realistically capture from a
 * meeting follow-up.
 */

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const MODEL = "whisper-1";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface TranscribeInput {
  /** Raw audio bytes. Common from MediaRecorder: webm/opus or mp4/aac. */
  audio: Blob;
  /** Filename Whisper uses to detect the format. */
  filename: string;
  /** Optional contact name etc. to bias the model toward correct spelling. */
  prompt?: string;
}

export interface TranscribeResult {
  text: string;
  /** Whisper-reported duration in seconds when available. */
  durationSec: number | null;
}

export class TranscriptionError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "TranscriptionError";
  }
}

export async function transcribeAudio(
  input: TranscribeInput,
): Promise<TranscribeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new TranscriptionError("OPENAI_API_KEY not set");
  }

  if (input.audio.size > MAX_UPLOAD_BYTES) {
    throw new TranscriptionError(
      `Audio too large (${input.audio.size} bytes; max ${MAX_UPLOAD_BYTES})`,
    );
  }

  const form = new FormData();
  form.append("file", input.audio, input.filename);
  form.append("model", MODEL);
  form.append("response_format", "verbose_json");
  if (input.prompt) form.append("prompt", input.prompt);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    throw new TranscriptionError(
      err instanceof Error ? err.message : "network error",
      undefined,
      true,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    throw new TranscriptionError(
      `Whisper ${res.status}: ${body.slice(0, 200)}`,
      res.status,
      retryable,
    );
  }

  const data = (await res.json()) as { text?: string; duration?: number };
  return {
    text: (data.text ?? "").trim(),
    durationSec: typeof data.duration === "number" ? Math.round(data.duration) : null,
  };
}
