"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { HeartPulse, Info, Loader2, RotateCcw, ScanFace } from "lucide-react";
import { Button, Card, CardHeader } from "./ui";
import { uploadFile } from "@/lib/upload";
import type { ModelObservation, ObservationMetric, Vitals } from "@/lib/types";

// The SDK's bundled decoder reads H.264, not the VP8/VP9 browsers use for WebM by default
const H264_TYPES = ["video/mp4;codecs=avc1.42E01F", "video/mp4;codecs=avc1", "video/webm;codecs=h264", "video/mp4"];

const LABELS: Record<ObservationMetric, string> = {
  heart_rate: "Pulse",
  respiratory_rate: "Breathing",
  hrv_sdnn: "HRV (SDNN)",
  hrv_rmssd: "HRV (RMSSD)",
};

// The SDK's capture hints, as instructions for whoever is holding the laptop
const HINT_ADVICE: [RegExp, string][] = [
  [/one face/i, "Someone else was in view. Only the patient should be in the frame."],
  [/no face/i, "The face wasn't found for part of the clip. Keep it inside the oval."],
  [/chest/i, "Sit back a little so the shoulders and upper chest are visible."],
  [/dark/i, "Too dark. Face a window or lamp."],
  [/bright/i, "Too bright. Avoid a light source behind or directly on the camera."],
  [/motion|move/i, "Too much movement. Sit still and don't talk."],
];
const advice = (h: string) => HINT_ADVICE.find(([re]) => re.test(h))?.[1] ?? h;

type Stage = "ready" | "measuring" | "analyzing" | "result" | "error";

const stepsFor = (seconds: number) => [
  `Recorded ${seconds}-second clip`,
  "Uploading clip",
  "Finding the face and skin region",
  "Extracting the pulse signal",
  "Averaging heart-rate readings",
  "Adding to the chart",
];
const FIRST_SERVER_STEP = 2; // steps 2-4 happen on the server; the bar ticks through them while it works
const AVERAGE_STEP = 4;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Check-in step, before the visit recording: a 30 s camera clip analysed by the configured
 * vision model(s). A reliable pulse goes straight into the chart (tagged with its source) and the
 * visit recording starts; otherwise the result is shown with Retake / start without it.
 */
export function VitalsCheck({
  encounterId,
  models,
  onVitals,
  onContinue,
}: {
  encounterId: string;
  models: { id: string; name: string; captureSeconds: number }[];
  onVitals: (v: Vitals) => void;
  onContinue: () => void;
}) {
  const seconds = Math.max(...models.map((m) => m.captureSeconds));
  const steps = stepsFor(seconds);
  const [stage, setStage] = useState<Stage>("ready");
  const [left, setLeft] = useState(seconds);
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);
  const go = (n: number) => {
    stepRef.current = n;
    setStep(n);
  };
  const [reading, setReading] = useState<ModelObservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [obs, setObs] = useState<ModelObservation[]>([]);
  const [hints, setHints] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const cancelled = useRef(false); // skipped or left mid-measurement: don't upload
  const modelName = models.map((m) => m.name).join(" + ");

  /** Opens the camera; if `isLive()` turned false while waiting for permission, the stream is dropped. */
  const openCamera = useCallback((isLive: () => boolean) => {
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      })
      .then(
        (s) => {
          if (!isLive()) return s.getTracks().forEach((t) => t.stop());
          stream.current = s;
          if (video.current) {
            video.current.srcObject = s;
            video.current.play().catch(() => {});
          }
        },
        (e) => {
          setError(`Camera unavailable: ${e instanceof Error ? e.message : e}. Allow camera access in the address bar, or skip the check.`);
          setStage("error");
        },
      );
  }, []);
  const closeCamera = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => {
    let live = true;
    cancelled.current = false;
    openCamera(() => live);
    return () => {
      live = false;
      cancelled.current = true;
      closeCamera();
    };
  }, [openCamera, closeCamera]);

  async function measure() {
    const s = stream.current;
    const mime = H264_TYPES.find((m) => MediaRecorder.isTypeSupported(m));
    if (!s || !mime) {
      setError(mime ? "Camera is not ready yet." : "This browser can't record H.264 video. Use a recent Chrome, Edge or Safari, or skip the check.");
      setStage("error");
      return;
    }
    setStage("measuring");
    setLeft(seconds);
    const rec = new MediaRecorder(s, { mimeType: mime, videoBitsPerSecond: 6_000_000 }); // high bitrate keeps the subtle skin-colour signal
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start(1000);
    for (let t = seconds; t > 0 && !cancelled.current; t--) {
      await new Promise((r) => setTimeout(r, 1000));
      setLeft(t - 1);
    }
    if (rec.state !== "inactive") rec.stop();
    await stopped;
    if (cancelled.current) return;

    setStage("analyzing");
    setReading(null);
    let ticker: ReturnType<typeof setInterval> | undefined;
    try {
      go(1);
      const blob = new Blob(chunks, { type: rec.mimeType || mime });
      const ext = blob.type.includes("mp4") ? "mp4" : "mkv";
      const path = await uploadFile(encounterId, "vitals", new File([blob], `checkin.${ext}`, { type: blob.type }));
      go(FIRST_SERVER_STEP);
      ticker = setInterval(() => stepRef.current < AVERAGE_STEP - 1 && go(stepRef.current + 1), 900);
      const r = await fetch(`/api/encounters/${encounterId}/observations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const j = await r.json();
      clearInterval(ticker);
      if (!r.ok) throw new Error(j.error ?? "Analysis failed");
      // Let each remaining step show briefly so the sequence is readable
      while (stepRef.current < AVERAGE_STEP) {
        await pause(350);
        go(stepRef.current + 1);
      }
      const found = j.observations as ModelObservation[];
      const reliable = found.find((o) => o.metric === "heart_rate" && o.status === "pending" && o.value !== null);
      if (reliable) {
        setReading(reliable);
        await pause(1200);
        go(AVERAGE_STEP + 1);
        if (await finish(reliable, true)) return;
      }
      setObs(found);
      setHints(j.hints);
      setStage("result");
    } catch (e) {
      clearInterval(ticker);
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }

  /** Optionally adds the reading to the chart, then hands over to the visit recording. False if it failed. */
  async function finish(accept: ModelObservation | null, auto = false) {
    setSaving(true);
    try {
      if (accept) {
        const r = await fetch(`/api/encounters/${encounterId}/observations/${accept.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "accepted", auto }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Could not add to chart");
        onVitals(j.vitals);
      }
      cancelled.current = true;
      closeCamera();
      onContinue();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
      return false;
    }
  }

  function retake() {
    setObs([]);
    setHints([]);
    setError(null);
    setStage("ready");
    if (!stream.current) openCamera(() => !cancelled.current);
  }

  const hr = obs.find((o) => o.metric === "heart_rate");
  const usableHr = hr && hr.status === "pending" && hr.value !== null ? hr : null;
  const others = obs.filter((o) => o.metric !== "heart_rate");

  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader
        title="Check-in vitals"
        subtitle={`${seconds}-second camera check before the visit recording · ${modelName}`}
        right={
          stage !== "analyzing" && (
            <Button variant="ghost" onClick={() => finish(null)} disabled={saving}>
              Skip
            </Button>
          )
        }
      />
      <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_260px]">
        {/* Camera */}
        <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-900">
          <video ref={video} className="h-full w-full -scale-x-100 object-cover" playsInline muted aria-label="Camera preview" />
          {(stage === "ready" || stage === "measuring") && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className={clsx("h-[70%] aspect-[3/4] rounded-[50%] border-2", stage === "measuring" ? "border-brand-500" : "border-white/70 border-dashed")} />
            </div>
          )}
          {stage === "measuring" && (
            <>
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
                <span className="rec-dot h-2 w-2 rounded-full bg-red-500" /> Measuring · {left}s
              </div>
              <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/20">
                <div className="h-full bg-brand-500 transition-[width] duration-1000 ease-linear" style={{ width: `${((seconds - left) / seconds) * 100}%` }} />
              </div>
            </>
          )}
          {stage === "analyzing" && (
            <div className="absolute inset-0 grid place-items-center bg-slate-900/70 text-sm text-white">
              <span className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" /> {steps[step]}…
              </span>
            </div>
          )}
        </div>

        {/* Instructions / result */}
        <div className="flex flex-col gap-4 text-sm">
          {(stage === "ready" || stage === "measuring") && (
            <>
              <ul className="space-y-2 text-slate-600">
                <li className="flex gap-2"><ScanFace size={16} className="mt-0.5 shrink-0 text-brand-600" /> Patient sits still, face inside the oval, shoulders in view. Nobody else in the frame.</li>
                <li className="flex gap-2"><Info size={16} className="mt-0.5 shrink-0 text-brand-600" /> Even, bright light on the face; no talking during the check.</li>
              </ul>
              <Button onClick={() => void measure()} disabled={stage === "measuring"} className="mt-auto">
                <HeartPulse size={16} /> {stage === "measuring" ? `Measuring… ${left}s` : `Start ${seconds}-second check`}
              </Button>
            </>
          )}

          {stage === "analyzing" && (
            <ol className="space-y-2" aria-live="polite">
              {steps.map((label, i) => (
                <li key={label} className={clsx("flex items-start gap-2", i < step ? "text-slate-500" : i === step ? "font-medium text-ink" : "text-slate-300")}>
                  <span className="mt-0.5 grid w-4 shrink-0 place-items-center">
                    {i < step ? "✓" : i === step ? <Loader2 size={13} className="animate-spin" /> : "·"}
                  </span>
                  <span>
                    {label}
                    {i === AVERAGE_STEP && reading?.value != null && (
                      <span className="mt-0.5 block text-xs font-normal text-brand-700">
                        → {Math.round(reading.value)} bpm · average of {reading.detail.samples} readings
                        {reading.detail.range ? ` (${reading.detail.range[0]}–${reading.detail.range[1]})` : ""}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {stage === "result" && (
            <>
              <div className={clsx("rounded-xl border p-4", usableHr ? "border-brand-200 bg-brand-50/60" : "border-amber-200 bg-amber-50")}>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Pulse · camera estimate</p>
                {hr?.value !== null && hr?.value !== undefined ? (
                  <p className="mt-1 text-3xl font-semibold tracking-tight">
                    {Math.round(hr.value)} <span className="text-base font-normal text-slate-500">bpm</span>
                  </p>
                ) : (
                  <p className="mt-1 font-medium">No reading</p>
                )}
                {hr && (
                  <p className="mt-1 text-xs text-slate-600">
                    {hr.detail.accuracy
                      ? `${hr.detail.stable_samples}/${hr.detail.samples} readings met the ${hr.detail.accuracy} accuracy standard`
                      : `Average of ${hr.detail.samples} readings`}
                    {hr.detail.range ? ` · range ${hr.detail.range[0]}–${hr.detail.range[1]}` : ""}
                    {hr.confidence !== null ? ` · confidence ${Math.round(hr.confidence)}%` : ""}
                  </p>
                )}
                {!usableHr && <p className="mt-2 text-xs text-amber-900">Not reliable enough to add to the chart. Retake, or measure manually.</p>}
              </div>

              {others.length > 0 && (
                <dl className="space-y-1 text-xs">
                  {others.map((o) => (
                    <div key={o.id} className="flex justify-between gap-2">
                      <dt className="text-slate-500">{LABELS[o.metric]}</dt>
                      <dd className={o.stable ? "font-medium" : "text-slate-400"}>{o.stable && o.value !== null ? `${o.value} ${o.unit}` : "not reliable"}</dd>
                    </div>
                  ))}
                  <p className="pt-1 text-slate-400">Shown for context only; not added to the chart.</p>
                </dl>
              )}

              {hints.length > 0 && (
                <ul className="space-y-1 text-xs text-amber-800">
                  {Array.from(new Set(hints.map(advice))).map((h) => (
                    <li key={h}>⚠ {h}</li>
                  ))}
                </ul>
              )}

              <div className="mt-auto flex flex-col gap-2">
                {usableHr && (
                  <Button onClick={() => finish(usableHr)} disabled={saving}>
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <HeartPulse size={16} />} Add {Math.round(usableHr.value!)} bpm & start visit
                  </Button>
                )}
                <Button variant="secondary" onClick={retake} disabled={saving}>
                  <RotateCcw size={14} /> Retake
                </Button>
                <Button variant="ghost" onClick={() => finish(null)} disabled={saving}>
                  Start visit without it
                </Button>
              </div>
              {hr?.detail.model_card && (
                <a href={hr.detail.model_card} target="_blank" rel="noreferrer" className="text-xs text-slate-400 underline">
                  Model card · {hr.model_version}
                </a>
              )}
            </>
          )}

          {stage === "error" && (
            <>
              <p className="text-red-600">{error}</p>
              <div className="mt-auto flex flex-col gap-2">
                <Button variant="secondary" onClick={retake}>
                  <RotateCcw size={14} /> Try again
                </Button>
                <Button variant="ghost" onClick={() => finish(null)}>
                  Start visit without it
                </Button>
              </div>
            </>
          )}
          {stage === "result" && error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </div>
    </Card>
  );
}
