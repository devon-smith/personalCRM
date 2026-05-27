/**
 * File → plain text extraction for VoiceReference uploads (M0.x.5).
 *
 * Accepts: .txt, .md, .pdf, .docx. Returns extracted plain text +
 * the canonical mime type we detected.
 *
 * Bounded — large files get truncated to MAX_REFERENCE_TEXT_BYTES.
 * The cap is generous (256KB plain text ≈ 60-80K tokens) but
 * prevents a runaway 50MB PDF from blowing the DB column.
 */

export const MAX_REFERENCE_TEXT_BYTES = 256 * 1024;
export const MAX_RAW_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

export type SupportedExt = "txt" | "md" | "pdf" | "docx";

export interface ParsedReference {
  /** Extracted plain text (possibly truncated). */
  text: string;
  /** True when the text was truncated to fit the cap. */
  truncated: boolean;
  /** Canonical extension we treated this as. */
  ext: SupportedExt;
}

export class UnsupportedReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedReferenceError";
  }
}

/** Map a filename to one of our supported extensions, or throw. */
export function detectExtension(filename: string): SupportedExt {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  throw new UnsupportedReferenceError(
    `Unsupported file type: ${filename}. Accepted: .txt, .md, .pdf, .docx`,
  );
}

/**
 * Extract plain text from a raw upload buffer. Caller owns dispatch
 * by filename. Async because the PDF/DOCX paths are async.
 */
export async function extractText(
  buffer: Buffer,
  filename: string,
): Promise<ParsedReference> {
  if (buffer.byteLength > MAX_RAW_UPLOAD_BYTES) {
    throw new UnsupportedReferenceError(
      `File too large: ${filename} (${buffer.byteLength} bytes; max ${MAX_RAW_UPLOAD_BYTES}).`,
    );
  }

  const ext = detectExtension(filename);
  let raw: string;
  switch (ext) {
    case "txt":
    case "md":
      raw = buffer.toString("utf-8");
      break;
    case "pdf":
      raw = await extractPdfText(buffer);
      break;
    case "docx":
      raw = await extractDocxText(buffer);
      break;
  }

  const normalized = normalizeWhitespace(raw);
  if (normalized.length === 0) {
    throw new UnsupportedReferenceError(
      `Could not extract any text from ${filename}.`,
    );
  }

  const byteLen = Buffer.byteLength(normalized, "utf-8");
  if (byteLen <= MAX_REFERENCE_TEXT_BYTES) {
    return { text: normalized, truncated: false, ext };
  }
  // Truncate at a UTF-8-safe byte boundary by slicing the string
  // proportionally — close enough for our cap.
  const ratio = MAX_REFERENCE_TEXT_BYTES / byteLen;
  const cutPoint = Math.floor(normalized.length * ratio);
  return {
    text: normalized.slice(0, cutPoint) + "\n\n[…truncated…]",
    truncated: true,
    ext,
  };
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  // unpdf is built for Node / serverless / edge runtimes — wraps
  // pdfjs-dist with sane defaults that don't need a Web Worker.
  // pdf-parse v2 (our previous choice) tried to set up pdfjs's
  // "fake worker" and crashed in Next.js dev with
  //   "Setting up fake worker failed: Cannot find module …"
  // when the user's cwd path had a quirk pdfjs-dist couldn't
  // resolve. unpdf side-steps all of that.
  const { extractText } = await import("unpdf");
  const { text } = await extractText(new Uint8Array(buffer), {
    mergePages: true,
  });
  // With mergePages:true the overload returns `text: string`. Cast
  // defensively in case the upstream type drifts to string[] on a
  // future major.
  if (Array.isArray(text)) return (text as string[]).join("\n\n");
  return typeof text === "string" ? text : "";
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = (await import("mammoth")) as {
    extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

/** Collapse multiple newlines / whitespace runs without destroying paragraph structure. */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Strip trailing whitespace on lines.
    .replace(/[ \t]+\n/g, "\n")
    // Collapse 3+ blank lines to a single blank.
    .replace(/\n{3,}/g, "\n\n")
    // Collapse runs of spaces/tabs.
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
