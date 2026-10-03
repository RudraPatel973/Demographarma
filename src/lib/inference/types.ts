import type { ObservationMetric, Vitals } from "@/lib/types";

/**
 * Contract every external medical AI model implements.
 * A model takes one kind of visit input and returns observations; it never writes to the chart.
 * The clinician decides what reaches the chart (see ../inference/index.ts).
 */
export interface ClinicalModel {
  id: string;
  name: string;
  vendor: string;
  /** What the model consumes. Only "video" today (a local file path). */
  input: "video";
  /** How long the check-in clip should be */
  captureSeconds: number;
  /** True when credentials etc. are present, so the model can be offered in the UI. */
  configured(): boolean;
  run(input: { videoPath: string }): Promise<ModelRun>;
}

export interface ModelRun {
  modelVersion: string;
  observations: ObservationDraft[];
  /** Capture-quality problems the model reported, e.g. "No face found." */
  hints: string[];
}

export interface ObservationDraft {
  metric: ObservationMetric;
  /** Median of the readings the vendor marked reliable (falls back to all readings when none were) */
  value: number | null;
  unit: string;
  /** Median vendor confidence of the readings used, 0-100 */
  confidence: number | null;
  /** Enough readings met the vendor's accuracy threshold to trust the value */
  stable: boolean;
  samples: number;
  stableSamples: number;
  range: [number, number] | null;
  /** Vendor's accuracy claim when stable, e.g. "±3 bpm" */
  accuracy: string;
  modelCard: string;
  /** Chart field the clinician can accept this into (none = shown for information only) */
  chartField?: keyof Omit<Vitals, "sources">;
}
