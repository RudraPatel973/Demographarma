"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptSegment } from "@/lib/types";
import { uploadFile } from "@/lib/upload";

/* Minimal typings for the Web Speech API (Chrome / Edge / Safari) */
type SRResult = { isFinal: boolean; 0: { transcript: string } };
type SREvent = { resultIndex: number; results: ArrayLike<SRResult> };
interface SR {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
function newRecognition(): SR | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return C ? new C() : null;
}

/**
 * Records the visit (video + audio) and transcribes it live.
 * onSegment fires for every finalized phrase.
 */
export function useVisitRecorder(opts: {
  encounterId: string;
  initial: TranscriptSegment[];
  onSegment: (all: TranscriptSegment[], latest: TranscriptSegment) => void;
  onVideoSaved: (path: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [videoStatus, setVideoStatus] = useState<string | null>(null);

  const segments = useRef<TranscriptSegment[]>(opts.initial);
  const stream = useRef<MediaStream | null>(null);
  const media = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const speech = useRef<SR | null>(null);
  const active = useRef(false);
  const t0 = useRef(0);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed((Date.now() - t0.current) / 1000), 500);
    return () => clearInterval(t);
  }, [recording]);

  const startSpeech = useCallback(() => {
    const sr = newRecognition();
    if (!sr) {
      setError("Live transcription needs Chrome, Edge or Safari.");
      return;
    }
    sr.continuous = true;
    sr.interimResults = true;
    sr.lang = "en-US";
    sr.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (!text) continue;
        if (r.isFinal) {
          const seg: TranscriptSegment = { speaker: "unknown", text, t: (Date.now() - t0.current) / 1000 };
          segments.current = [...segments.current, seg];
          optsRef.current.onSegment(segments.current, seg);
        } else live += text + " ";
      }
      setInterim(live);
    };
    sr.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("Microphone access was blocked. Allow it in the address bar and press Start.");
    };
    sr.onend = () => {
      // Chrome stops after silence or ~60s; keep listening while the visit is live
      if (active.current) {
        try {
          sr.start();
        } catch {
          /* already running */
        }
      }
    };
    sr.start();
    speech.current = sr;
  }, []);

  const start = useCallback(async () => {
    if (active.current) return;
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 360 } }).catch(() =>
        navigator.mediaDevices.getUserMedia({ audio: true }),
      );
      stream.current = s;
      const mime = ["video/webm;codecs=vp9,opus", "video/webm", "audio/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
      const mr = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.start(1000);
      media.current = mr;
      active.current = true;
      t0.current = Date.now() - (segments.current.at(-1)?.t ?? 0) * 1000;
      startSpeech();
      setRecording(true);
    } catch (e) {
      setError(`Could not access the microphone: ${e instanceof Error ? e.message : e}`);
    }
  }, [startSpeech]);

  /** Stops everything; uploads the recording in the background. */
  const stop = useCallback(() => {
    active.current = false;
    speech.current?.stop();
    speech.current = null;
    const mr = media.current;
    if (mr && mr.state !== "inactive") {
      mr.onstop = async () => {
        if (!chunks.current.length) return;
        const blob = new Blob(chunks.current, { type: mr.mimeType || "video/webm" });
        setVideoStatus("Saving recording…");
        try {
          const ext = blob.type.includes("mp4") ? "mp4" : "webm";
          const path = await uploadFile(optsRef.current.encounterId, "video", new File([blob], `visit.${ext}`, { type: blob.type }));
          optsRef.current.onVideoSaved(path);
          setVideoStatus("Recording saved");
        } catch (e) {
          setVideoStatus(`Recording upload failed: ${e instanceof Error ? e.message : e}`);
        }
      };
      mr.stop();
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    setRecording(false);
    setInterim("");
    return segments.current;
  }, []);

  useEffect(
    () => () => {
      active.current = false;
      speech.current?.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  /** Bind the live camera to a <video> element. */
  const videoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el && stream.current && recording) {
        el.srcObject = stream.current;
        el.muted = true;
        el.play().catch(() => {});
      }
    },
    [recording],
  );

  return { start, stop, recording, interim, elapsed, error, videoStatus, videoRef };
}
