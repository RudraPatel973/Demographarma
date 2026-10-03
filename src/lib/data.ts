import "server-only";
import { db, must } from "./supabase";
import type { Diagnosis, Encounter, Medication, Patient, PatientMessage, Prescription, Recommendation } from "./types";

export async function getEncounterBundle(id: string) {
  const encounter = must(await db().from("encounters").select("*").eq("id", id).single()) as Encounter;
  const patient = must(await db().from("patients").select("*").eq("id", encounter.patient_id).single()) as Patient;
  const recommendations = must(
    await db().from("recommendations").select("*").eq("encounter_id", id).order("created_at", { ascending: false }).order("rank"),
  ) as Recommendation[];
  // only the latest generation run
  const latestAt = recommendations[0]?.created_at;
  const latest = recommendations.filter((r) => r.created_at === latestAt).sort((a, b) => a.rank - b.rank);
  const run = must(
    await db().from("generation_runs").select("*").eq("encounter_id", id).order("created_at", { ascending: false }).limit(1),
  ) as { clinical_note: string | null; excluded: unknown; candidates: unknown; engine: string; model: string | null }[];
  const prescriptions = must(
    await db().from("prescriptions").select("*").eq("encounter_id", id).order("created_at", { ascending: false }),
  ) as Prescription[];
  const medIds = Array.from(new Set([...latest.map((r) => r.medication_id), ...prescriptions.map((p) => p.medication_id)].filter((x): x is string => Boolean(x))));
  const medications = medIds.length
    ? (must(await db().from("medications").select("*").in("id", medIds)) as Medication[])
    : [];
  const messages = must(
    await db().from("patient_messages").select("*").eq("patient_id", patient.id).order("created_at"),
  ) as PatientMessage[];
  return { encounter, patient, recommendations: latest, run: run[0] ?? null, prescriptions, medications, messages };
}

export async function listDiagnoses() {
  return must(await db().from("diagnoses").select("*").order("icd10")) as Diagnosis[];
}

export async function listMedications() {
  return must(
    await db().from("medications").select("id,generic_name,brand_names,drug_class,class_key,usual_dose_min_mg,usual_dose_max_mg,start_dose_mg,doses_per_day,available_strengths").order("generic_name"),
  ) as Pick<Medication, "id" | "generic_name" | "brand_names" | "drug_class" | "class_key" | "usual_dose_min_mg" | "usual_dose_max_mg" | "start_dose_mg" | "doses_per_day" | "available_strengths">[];
}
