"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface VoiceRecorderProps {
  contactId: string;
  /** Called after a successful transcription so the parent can refetch
   *  the contact's journal list. */
  onTranscribed?: (entry: {
    id: string;
    content: string;
    durationSec: number | null;
    createdAt: string;
  }) => void;
}

type State =
  | { kind: "idle" }
  | { kind: "recording"; chunks: Blob[]; startedAt: number }
  | { kind: "review"; blob: Blob; durationSec: number }
  | { kind: "uploading" };

const SUPPORTED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of SUPPORTED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

/**
 * Mic-button + transcribe flow for a contact's voice memos.
 * One-shot: tap to start, tap to stop, review the blob length, send.
 * The audio is uploaded once and then discarded server-side; only the
 * transcript is persisted as a JournalEntry.
 */
export function VoiceRecorder({ contactId, onTranscribed }: VoiceRecorderProps) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [elapsedSec, setElapsedSec] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Cleanup on unmount: stop any open mic stream so the OS releases it
  // and the browser indicator turns off.
  useEffect(() => {
    return () => {
      stopStream();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const startRecording = useCallback(async () => {
    const mimeType = pickMimeType();
    if (!mimeType) {
      toast.error("Recording is not supported in this browser.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      toast.error(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : "Couldn't access the microphone.",
      );
      return;
    }
    streamRef.current = stream;

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const elapsedMs = Date.now() - (state.kind === "recording" ? state.startedAt : Date.now());
      setState({
        kind: "review",
        blob,
        durationSec: Math.max(1, Math.round(elapsedMs / 1000)),
      });
      stopStream();
    };

    const startedAt = Date.now();
    recorder.start();
    setState({ kind: "recording", chunks, startedAt });
    setElapsedSec(0);

    intervalRef.current = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);
  }, [state]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const discardRecording = useCallback(() => {
    setState({ kind: "idle" });
    setElapsedSec(0);
  }, []);

  const uploadRecording = useCallback(async () => {
    if (state.kind !== "review") return;
    setState({ kind: "uploading" });

    const form = new FormData();
    form.append("audio", state.blob, `voice-${Date.now()}.webm`);
    form.append("contactId", contactId);

    try {
      const res = await fetch("/api/notes/transcribe", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Transcription failed");
      }
      const entry = await res.json();
      toast.success("Note transcribed");
      onTranscribed?.(entry);
      setState({ kind: "idle" });
      setElapsedSec(0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
      setState({ kind: "review", blob: state.blob, durationSec: state.durationSec });
    }
  }, [state, contactId, onTranscribed]);

  return (
    <div
      className="flex items-center gap-2 rounded-[10px] px-3 py-2"
      style={{
        backgroundColor: "var(--surface-sunken)",
        border: "1px solid var(--border)",
      }}
    >
      {state.kind === "idle" && (
        <>
          <button
            type="button"
            onClick={startRecording}
            className="flex items-center gap-1.5 text-[12px] font-medium rounded-[8px] px-3 py-1.5"
            style={{
              backgroundColor: "var(--accent-color)",
              color: "var(--text-inverse)",
            }}
          >
            <Mic className="h-3.5 w-3.5" />
            Record voice memo
          </button>
        </>
      )}

      {state.kind === "recording" && (
        <>
          <button
            type="button"
            onClick={stopRecording}
            className="flex items-center gap-1.5 text-[12px] font-medium rounded-[8px] px-3 py-1.5"
            style={{
              backgroundColor: "var(--status-error, #DC2626)",
              color: "white",
            }}
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            Stop · {formatDuration(elapsedSec)}
          </button>
          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            Recording…
          </span>
        </>
      )}

      {state.kind === "review" && (
        <>
          <button
            type="button"
            onClick={uploadRecording}
            className="flex items-center gap-1.5 text-[12px] font-medium rounded-[8px] px-3 py-1.5"
            style={{
              backgroundColor: "var(--accent-color)",
              color: "var(--text-inverse)",
            }}
          >
            <Check className="h-3.5 w-3.5" />
            Transcribe ({formatDuration(state.durationSec)})
          </button>
          <button
            type="button"
            onClick={discardRecording}
            className="rounded-[8px] p-1.5"
            style={{ color: "var(--text-tertiary)" }}
            aria-label="Discard recording"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}

      {state.kind === "uploading" && (
        <span
          className="flex items-center gap-2 text-[12px] font-medium"
          style={{ color: "var(--text-tertiary)" }}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Transcribing…
        </span>
      )}
    </div>
  );
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
