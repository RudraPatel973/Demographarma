import "server-only";
import type { ClinicalModel, ModelRun, ObservationDraft } from "./types";

/**
 * Presage SmartSpectra: camera-based (rPPG) pulse, breathing and HRV.
 * https://smartspectra.presagetech.com/docs/nodejs/
 *
 * Runs the native SDK in this Node process on a recorded clip. The SDK checks the API key
 * against Presage's servers. Its native state is process-global, so runs are serialized.
 * `stable` is the vendor's flag for "meets the accuracy standard" (pulse ±3 bpm at
 * confidence >= 40, breathing ±1 /min at >= 45, HRV ±5 ms at >= 50; see the model cards).
 */

const MODEL_CARDS = {
  pulse: "https://vandv.presagetech.com/arterial_pressure_model_card.html",
  breathing: "https://vandv.presagetech.com/breathing_model_card.html",
  hrv: "https://vandv.presagetech.com/hrv_model_card.html",
};
// A value counts as reliable only when at least this many readings met the vendor's threshold
const MIN_STABLE_READINGS = 3;
const RUN_TIMEOUT_MS = 120_000;
// Play the clip back at camera speed (~30 fps). Decoding as fast as possible yields almost no readings.
const INTERFRAME_DELAY_MS = 33;

type Reading = { value?: number | null; confidence?: number | null; stable?: boolean | null };
type Hrv = { sdnn?: number | null; rmssd?: number | null; confidence?: number | null; stable?: boolean | null };
type Decoded = { cardio?: { pulseRate?: Reading[]; hrv?: Hrv[] }; breathing?: { rate?: Reading[] } };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x: number | null, dp = 0) => (x === null ? null : Math.round(x * 10 ** dp) / 10 ** dp);

function summarize(
  readings: { value: number; confidence: number; stable: boolean }[],
  base: Pick<ObservationDraft, "metric" | "unit" | "accuracy" | "modelCard" | "chartField">,
): ObservationDraft | null {
  if (!readings.length) return null;
  const good = readings.filter((r) => r.stable);
  const stable = good.length >= MIN_STABLE_READINGS;
  const used = stable ? good : readings;
  const values = used.map((r) => r.value);
  return {
    ...base,
    value: round(median(values)),
    confidence: round(median(used.map((r) => r.confidence))),
    stable,
    samples: readings.length,
    stableSamples: good.length,
    range: [round(Math.min(...values))!, round(Math.max(...values))!],
  };
}

// One SDK session at a time per process
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

async function analyze(videoPath: string): Promise<ModelRun> {
  const ss = await import("@smartspectra/node-sdk");
  const sdk = new ss.SmartSpectraSDK({
    apiKey: process.env.SMARTSPECTRA_API_KEY,
    requestedMetrics: [...ss.cardioMetrics, ...ss.breathingMetrics],
    enableTelemetry: false,
    logLevel: ss.SmartSpectraLogLevel.kError,
  });

  const pulse: { value: number; confidence: number; stable: boolean }[] = [];
  const breathing: typeof pulse = [];
  const sdnn: typeof pulse = [];
  const rmssd: typeof pulse = [];
  const hints = new Set<string>();
  const take = (into: typeof pulse, r: Reading | Hrv, v: number | null | undefined) => {
    if (typeof v === "number" && Number.isFinite(v)) into.push({ value: v, confidence: r.confidence ?? 0, stable: Boolean(r.stable) });
  };

  let fatal: Error | null = null;
  let stopping = false;
  sdk.on("validationStatus", (code, _ts, hint) => {
    if (code !== 0 && hint) hints.add(hint);
  });
  sdk.on("metrics", (buf) => {
    const m = ss.decodeMetrics(buf) as Decoded;
    for (const r of m.cardio?.pulseRate ?? []) take(pulse, r, r.value);
    for (const r of m.breathing?.rate ?? []) take(breathing, r, r.value);
    for (const h of m.cardio?.hrv ?? []) {
      take(sdnn, h, h.sdnn);
      take(rmssd, h, h.rmssd);
    }
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("SmartSpectra timed out analyzing the clip")), RUN_TIMEOUT_MS);
      const done = (e?: Error) => {
        clearTimeout(timer);
        if (e) reject(e);
        else resolve();
      };
      let running = false;
      sdk.on("error", (code, message, retryable) => {
        if (stopping && code === ss.SmartSpectraErrorCode.kInvalidState) return; // noise while draining
        if (!retryable) fatal = Object.assign(new Error(`SmartSpectra: ${message}`), { code });
      });
      sdk.on("processingStatus", (s) => {
        if (s === ss.ProcessingStatus.kRunning) running = true;
        if (s === ss.ProcessingStatus.kError) done(fatal ?? new Error("SmartSpectra failed to process the clip"));
        else if (running && s === ss.ProcessingStatus.kIdle) done(); // end of file
      });
      sdk.useFile(videoPath, { interframeDelayMs: INTERFRAME_DELAY_MS });
      sdk.start();
    });
  } finally {
    stopping = true;
    await sdk.stopAsync().catch(() => {});
    await sdk.destroy();
  }
  if (fatal) throw fatal;

  const observations = [
    summarize(pulse, { metric: "heart_rate", unit: "bpm", accuracy: "±3 bpm", modelCard: MODEL_CARDS.pulse, chartField: "heart_rate" }),
    summarize(breathing, { metric: "respiratory_rate", unit: "/min", accuracy: "±1 breath/min", modelCard: MODEL_CARDS.breathing }),
    summarize(sdnn, { metric: "hrv_sdnn", unit: "ms", accuracy: "±5 ms", modelCard: MODEL_CARDS.hrv }),
    summarize(rmssd, { metric: "hrv_rmssd", unit: "ms", accuracy: "±5 ms", modelCard: MODEL_CARDS.hrv }),
  ].filter((o): o is ObservationDraft => o !== null);

  return { modelVersion: `node-sdk ${ss.SmartSpectraSDK.version}`, observations, hints: [...hints] };
}

export const smartSpectra: ClinicalModel = {
  id: "smartspectra",
  name: "SmartSpectra",
  vendor: "Presage Technologies",
  input: "video",
  captureSeconds: 30,
  configured: () => process.env.VITALS_MODEL === "smartspectra" && Boolean(process.env.SMARTSPECTRA_API_KEY),
  run: ({ videoPath }) => serialized(() => analyze(videoPath)),
};
