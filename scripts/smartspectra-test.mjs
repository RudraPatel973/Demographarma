// Standalone SmartSpectra smoke test (not part of the app).
//
//   SMARTSPECTRA_API_KEY=... node scripts/smartspectra-test.mjs              # webcam, 30 s
//   SMARTSPECTRA_API_KEY=... DURATION=60 node scripts/smartspectra-test.mjs   # longer (HRV / breathing need more data)
//   SMARTSPECTRA_API_KEY=... node scripts/smartspectra-test.mjs visit.mp4    # recorded video
import {
  SmartSpectraSDK,
  SmartSpectraLogLevel,
  CameraSelection,
  ProcessingStatus,
  cardioMetrics,
  breathingMetrics,
  decodeMetrics,
} from "@smartspectra/node-sdk";

const apiKey = process.env.SMARTSPECTRA_API_KEY;
if (!apiKey) throw new Error("Set SMARTSPECTRA_API_KEY");
const file = process.argv[2];
const seconds = Number(process.env.DURATION ?? 30);
const MIN_CONFIDENCE = 70; // SDK confidence is 0–100

const sdk = new SmartSpectraSDK({
  apiKey,
  requestedMetrics: [...cardioMetrics, ...breathingMetrics],
  enableAccumulatedOutput: true, // one summary packet when the session ends
  enableTelemetry: false,
  logLevel: SmartSpectraLogLevel.kError,
});

// Most packets carry no new reading for a given metric, so collect only the ones that do
const readings = { pulse: [], breathing: [], hrv: [] };
let stopping = false;

const fmt = (m) => `${m.value.toFixed(1)} (conf ${Math.round(m.confidence ?? 0)}%${m.stable ? ", stable" : ""})`;
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const good = (xs) => xs.filter((m) => m.stable && (m.confidence ?? 0) >= MIN_CONFIDENCE).map((m) => m.value);

let lastHint = "";
sdk.on("validationStatus", (code, _ts, hint) => {
  if (code !== 0 && hint !== lastHint) console.log(`[quality] ${hint}`);
  lastHint = code === 0 ? "" : hint;
});
sdk.on("metrics", (buf) => {
  const m = decodeMetrics(buf);
  for (const p of m.cardio?.pulseRate ?? []) readings.pulse.push(p), console.log(`pulse     ${fmt(p)} bpm`);
  for (const b of m.breathing?.rate ?? []) readings.breathing.push(b), console.log(`breathing ${fmt(b)} /min`);
  for (const h of m.cardio?.hrv ?? []) readings.hrv.push(h);
});
sdk.on("error", (code, message, retryable) => {
  if (stopping && code === 1) return; // invalid-state notice while the pipeline drains on stop
  console.error(`[error ${code}] ${message}${retryable ? " (retryable)" : ""}`);
});

if (file) {
  // Resolve when playback reaches end-of-file (back to idle) or fails
  const done = new Promise((resolve) => {
    let running = false;
    sdk.on("processingStatus", (s) => {
      if (s === ProcessingStatus.kRunning) running = true;
      if (s === ProcessingStatus.kError || (running && s === ProcessingStatus.kIdle)) resolve();
    });
  });
  sdk.useFile(file);
  sdk.start();
  await done;
} else {
  sdk.useCamera(CameraSelection.default);
  sdk.start();
  console.log(`Measuring for ${seconds} s — sit still, face the camera, good light.`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
}
stopping = true;
await sdk.stopAsync();
await sdk.destroy();

const pulse = good(readings.pulse);
const breathing = good(readings.breathing);
const hrv = readings.hrv.at(-1);
console.log(`\n=== summary (stable readings with confidence ≥ ${MIN_CONFIDENCE}%) ===`);
console.log(`pulse      ${pulse.length ? `${median(pulse).toFixed(0)} bpm  (median of ${pulse.length}/${readings.pulse.length} readings, range ${Math.min(...pulse).toFixed(0)}–${Math.max(...pulse).toFixed(0)})` : `no usable reading (${readings.pulse.length} low-confidence)`}`);
console.log(`breathing  ${breathing.length ? `${median(breathing).toFixed(0)} /min (median of ${breathing.length}/${readings.breathing.length})` : `no usable reading (${readings.breathing.length} low-confidence)`}`);
console.log(`hrv        ${hrv ? `RMSSD ${hrv.rmssd?.toFixed(0)} ms, SDNN ${hrv.sdnn?.toFixed(0)} ms` : "not reported (try DURATION=60 or longer)"}`);
