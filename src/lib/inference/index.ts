import "server-only";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db, MEDIA_BUCKET, must } from "@/lib/supabase";
import type { Encounter, ModelObservation, Vitals } from "@/lib/types";
import { demoPulse } from "./demo";
import { smartSpectra } from "./smartspectra";
import type { ClinicalModel } from "./types";

/**
 * Inference layer: runs external medical AI models on visit inputs and records what they inferred.
 *
 * Models only produce observations (table model_observations). An observation reaches the chart
 * (encounters.vitals) only once accepted (automatically at check-in when reliable), and then carries its provenance in
 * vitals.sources so the rule engine, the ranking model and the visit summary can show where it came from.
 * To add a model: implement ClinicalModel and list it here.
 * Check-in reader: VITALS_MODEL=smartspectra (needs SMARTSPECTRA_API_KEY) or VITALS_MODEL=demo (placeholder, see demo.ts).
 * Unset = no check-in step.
 */
const MODELS: ClinicalModel[] = [smartSpectra, demoPulse];

export function availableModels(input: ClinicalModel["input"]) {
  return MODELS.filter((m) => m.input === input && m.configured());
}

const MISSING_TABLE = /model_observations/;
function explain(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (MISSING_TABLE.test(msg) && /does not exist|schema cache/i.test(msg)) {
    throw new Error("Run supabase/migrations/0007_model_observations.sql in the Supabase SQL editor to enable model observations.");
  }
  throw e;
}

export async function listObservations(encounterId: string): Promise<ModelObservation[]> {
  const { data, error } = await db().from("model_observations").select("*").eq("encounter_id", encounterId).order("created_at", { ascending: false });
  if (error) return []; // table not created yet: the visit still works without it
  return data as ModelObservation[];
}

/** Check-in vitals: run every configured video model on the uploaded clip. */
export async function runVideoModels(encounterId: string, mediaPath: string) {
  const models = availableModels("video");
  if (!models.length) throw Object.assign(new Error("No check-in reader is configured (set VITALS_MODEL)."), { status: 400 });

  const dl = await db().storage.from(MEDIA_BUCKET).download(mediaPath);
  if (dl.error || !dl.data) throw new Error(`Could not read the clip: ${dl.error?.message ?? "not found"}`);
  const dir = await mkdtemp(path.join(tmpdir(), "inference-"));
  const file = path.join(dir, path.basename(mediaPath));
  await writeFile(file, Buffer.from(await dl.data.arrayBuffer()));

  const hints: string[] = [];
  const rows: Omit<ModelObservation, "id" | "created_at" | "reviewed_at">[] = [];
  try {
    for (const m of models) {
      const out = await m.run({ videoPath: file });
      hints.push(...out.hints);
      for (const o of out.observations) {
        rows.push({
          encounter_id: encounterId,
          model: m.id,
          model_version: out.modelVersion,
          metric: o.metric,
          value: o.value,
          unit: o.unit,
          confidence: o.confidence,
          stable: o.stable,
          detail: {
            model_name: m.name,
            samples: o.samples,
            stable_samples: o.stableSamples,
            range: o.range,
            hints: out.hints,
            accuracy: o.accuracy,
            model_card: o.modelCard,
          },
          // Values that map to a chart field wait for the clinician; the rest are context only
          status: o.chartField && o.stable ? "pending" : "info",
          media_path: mediaPath,
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // A new check replaces the previous one that was never reviewed
  const prev = await db().from("model_observations").update({ status: "superseded" }).eq("encounter_id", encounterId).in("status", ["pending", "info"]);
  if (prev.error) explain(new Error(prev.error.message));
  const observations = rows.length
    ? (must(await db().from("model_observations").insert(rows).select("*")) as ModelObservation[])
    : [];
  return { observations, hints: Array.from(new Set(hints)) };
}

/**
 * Accept (write the value into the chart, with provenance) or reject an observation.
 * `via` records whether the check-in added it automatically or a clinician clicked it.
 */
export async function reviewObservation(encounterId: string, observationId: string, decision: "accepted" | "rejected", via: "auto" | "clinician" = "clinician") {
  const obs = must(
    await db().from("model_observations").select("*").eq("id", observationId).eq("encounter_id", encounterId).single(),
  ) as ModelObservation;
  if (decision === "accepted" && (obs.status !== "pending" || obs.value === null)) {
    throw Object.assign(new Error("Only a reliable, unreviewed reading can be added to the chart."), { status: 409 });
  }
  const detail = decision === "accepted" ? { ...obs.detail, accepted_via: via } : obs.detail;
  must(await db().from("model_observations").update({ status: decision, detail, reviewed_at: new Date().toISOString() }).eq("id", obs.id).select("id"));

  const enc = must(await db().from("encounters").select("vitals").eq("id", encounterId).single()) as Pick<Encounter, "vitals">;
  let vitals: Vitals = enc.vitals ?? {};
  if (decision === "accepted" && obs.metric === "heart_rate") {
    vitals = {
      ...vitals,
      heart_rate: Math.round(obs.value!),
      sources: {
        ...vitals.sources,
        heart_rate: { model: obs.model, model_name: obs.detail.model_name ?? obs.model, observation_id: obs.id, confidence: obs.confidence },
      },
    };
    must(await db().from("encounters").update({ vitals, updated_at: new Date().toISOString() }).eq("id", encounterId).select("id"));
  }
  return { vitals };
}
