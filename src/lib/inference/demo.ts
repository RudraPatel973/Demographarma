import "server-only";
import type { ClinicalModel, ModelRun } from "./types";

/**
 * Placeholder pulse reader for demos (VITALS_MODEL=demo). The clip is recorded and stored like a real
 * check-in, but the readings are generated (one per second of the 10 s capture, around a resting
 * baseline) and averaged; nothing is measured from the video. Its observations keep model "demo_pulse"
 * in model_observations, so they can always be told apart from real readings.
 */
const CAPTURE_SECONDS = 10;

async function run(): Promise<ModelRun> {
  const baseline = 64 + Math.random() * 14; // 64-78 bpm
  const readings = Array.from({ length: CAPTURE_SECONDS }, () => baseline + (Math.random() - 0.5) * 4);
  const mean = readings.reduce((a, b) => a + b, 0) / readings.length;
  const r = (x: number) => Math.round(x);
  return {
    modelVersion: "demo-1",
    hints: [],
    observations: [
      {
        metric: "heart_rate",
        value: r(mean),
        unit: "bpm",
        confidence: null,
        stable: true,
        samples: readings.length,
        stableSamples: readings.length,
        range: [r(Math.min(...readings)), r(Math.max(...readings))],
        accuracy: "",
        modelCard: "",
        chartField: "heart_rate",
      },
    ],
  };
}

export const demoPulse: ClinicalModel = {
  id: "demo_pulse",
  name: "Camera pulse",
  vendor: "Demographarma",
  input: "video",
  captureSeconds: CAPTURE_SECONDS,
  configured: () => process.env.VITALS_MODEL === "demo",
  run,
};
