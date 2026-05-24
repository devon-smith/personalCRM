import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { transcribeAudio, TranscriptionError, MAX_UPLOAD_BYTES } from "@/lib/transcription";
import { logAIGeneration } from "@/lib/ai-generation-log";

/**
 * POST /api/notes/transcribe
 *
 * Multipart upload: { audio: Blob, contactId: string, mood?: string }
 * → transcribes via Whisper → stores a JournalEntry row with
 * source="voice" → returns the created entry.
 *
 * The audio file is NOT persisted: transcript is the durable artifact,
 * audio is discarded after Whisper returns. Keeps storage costs at zero.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  const audio = formData.get("audio");
  const contactId = formData.get("contactId");
  const mood = formData.get("mood");

  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "audio file is required" }, { status: 400 });
  }
  if (typeof contactId !== "string" || !contactId) {
    return NextResponse.json({ error: "contactId is required" }, { status: 400 });
  }
  if (audio.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `Audio too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)` },
      { status: 413 },
    );
  }

  // Ownership check
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId: session.user.id },
    select: { id: true, name: true },
  });
  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const startedAt = Date.now();
  let transcript;
  try {
    transcript = await transcribeAudio({
      audio,
      filename: (audio as File).name ?? `voice-${Date.now()}.webm`,
      // Prime Whisper with the contact name so it doesn't garble it.
      prompt: contact.name,
    });
  } catch (err) {
    const status = err instanceof TranscriptionError ? err.status ?? 502 : 502;
    await logAIGeneration({
      userId: session.user.id,
      feature: "voice_transcribe",
      model: "whisper-1",
      inputRefs: [`contact:${contactId}`],
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Transcription failed" },
      { status },
    );
  }

  if (!transcript.text) {
    return NextResponse.json(
      { error: "Empty transcription. Try a longer recording." },
      { status: 400 },
    );
  }

  const moodValue =
    mood === "POSITIVE" || mood === "NEUTRAL" || mood === "CONCERN" ? mood : "NEUTRAL";

  const entry = await prisma.journalEntry.create({
    data: {
      contactId,
      userId: session.user.id,
      content: transcript.text,
      mood: moodValue,
      source: "voice",
      voiceDurationSec: transcript.durationSec,
    },
  });

  await logAIGeneration({
    userId: session.user.id,
    feature: "voice_transcribe",
    model: "whisper-1",
    inputRefs: [`contact:${contactId}`],
    outputId: entry.id,
    latencyMs: Date.now() - startedAt,
  });

  return NextResponse.json({
    id: entry.id,
    content: entry.content,
    mood: entry.mood,
    durationSec: entry.voiceDurationSec,
    createdAt: entry.createdAt.toISOString(),
  });
}

// Next.js: increase payload limit so multipart audio uploads don't get
// truncated at the default 4 MB body-parser cap.
export const runtime = "nodejs";
