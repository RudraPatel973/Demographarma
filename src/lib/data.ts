import "server-only";
import { db, MEDIA_BUCKET, must } from "./supabase";
import { listObservations } from "./inference";
import type { Diagnosis, Encounter, Medication, Patient, PatientMessage, Prescription, Recommendation } from "./types";

export async function getEncounterBundle(id: string) {
  const encounter = must(await db().from("encounters").select("*").eq("id", id).single()) as Encounter;
  const patient = must(await db().from("patients").select("*").eq("id", encounter.patient_id).single()) as Patient;
  const allRecs = must(
    await db().from("recommendations").select("*").eq("encounter_id", id).order("created_at", { ascending: false }).order("rank"),
  ) as Recommendation[];
  // latest batch for pill 1; pill 2 only if it was generated after that batch
  const slot1At = allRecs.find((r) => (r.slot ?? 1) === 1)?.created_at;
  const latest = allRecs.filter((r) => (r.slot ?? 1) === 1 && r.created_at === slot1At).sort((a, b) => a.rank - b.rank);
  const slot2At = allRecs.find((r) => r.slot === 2 && slot1At && r.created_at > slot1At)?.created_at;
  const second = slot2At ? allRecs.filter((r) => r.slot === 2 && r.created_at === slot2At).sort((a, b) => a.rank - b.rank) : [];
  const runs = must(
    await db().from("generation_runs").select("*").eq("encounter_id", id).order("created_at", { ascending: false }).limit(6),
  ) as { clinical_note: string | null; excluded: unknown; candidates: { slot?: number }[]; engine: string; model: string | null; created_at: string }[];
  const runFor = (slot: number) => runs.find((r) => (r.candidates?.[0]?.slot ?? 1) === slot) ?? null;
  const prescriptions = must(
    await db().from("prescriptions").select("*").eq("encounter_id", id).order("created_at", { ascending: false }),
  ) as Prescription[];
  const medIds = Array.from(new Set([...latest, ...second].map((r) => r.medication_id).concat(prescriptions.map((p) => p.medication_id ?? "")).filter(Boolean)));
  const medications = medIds.length
    ? (must(await db().from("medications").select("*").in("id", medIds)) as Medication[])
    : [];
  const messages = must(
    await db().from("patient_messages").select("*").eq("patient_id", patient.id).order("created_at"),
  ) as PatientMessage[];
  const observations = await listObservations(id);
  return { encounter, patient, recommendations: latest, second, run: runFor(1), run2: slot2At ? runFor(2) : null, prescriptions, medications, messages, observations };
}

export async function listDiagnoses() {
  return must(await db().from("diagnoses").select("*").order("icd10")) as Diagnosis[];
}

export async function listMedications() {
  return must(
    await db().from("medications").select("id,generic_name,brand_names,drug_class,class_key,usual_dose_min_mg,usual_dose_max_mg,start_dose_mg,doses_per_day,available_strengths").order("generic_name"),
  ) as Pick<Medication, "id" | "generic_name" | "brand_names" | "drug_class" | "class_key" | "usual_dose_min_mg" | "usual_dose_max_mg" | "start_dose_mg" | "doses_per_day" | "available_strengths">[];
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
export type VisitRow = {
  id: string;
  status: Encounter["status"];
  created_at: string;
  diagnosis_id: string | null;
  diagnosis_notes: string | null;
  vitals: Encounter["vitals"];
  labs: Encounter["labs"];
  live_state: Encounter["live_state"];
  patients: Pick<Patient, "id" | "first_name" | "last_name" | "date_of_birth" | "sex"> | null;
  diagnoses: Pick<Diagnosis, "name" | "icd10"> | null;
  prescriptions: (Pick<Prescription, "id" | "dose_mg" | "status" | "is_override" | "custom_medication" | "created_at"> & {
    medications: Pick<Medication, "generic_name"> | null;
  })[];
};

const VISIT_SELECT =
  "id,status,created_at,vitals,labs,live_state,diagnosis_id,diagnosis_notes,patients(id,first_name,last_name,date_of_birth,sex),diagnoses(name,icd10),prescriptions(id,dose_mg,status,is_override,custom_medication,created_at,medications(generic_name))";

export async function listVisits(opts: { status?: string; q?: string; patientId?: string; limit?: number } = {}) {
  let query = db()
    .from("encounters")
    .select(VISIT_SELECT)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.status === "in_progress") query = query.in("status", ["in_progress", "recommended", "med_chosen"]);
  else if (opts.status) query = query.eq("status", opts.status);
  if (opts.patientId) query = query.eq("patient_id", opts.patientId);
  let rows = must(await query) as unknown as VisitRow[];
  if (opts.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter((r) => `${r.patients?.first_name ?? ""} ${r.patients?.last_name ?? ""}`.toLowerCase().includes(q));
  }
  return rows;
}

/**
 * Deletes a visit and everything recorded for it: recommendations, prescriptions (and their patient
 * messages) and model observations cascade in the database; stored media (recording, documents,
 * check-in clip) is removed from storage. The placeholder patient a "new patient" visit creates
 * (no name, no other visits) is removed too. Prescriptions already sent to Photon are not cancelled.
 */
export async function deleteVisit(id: string) {
  const enc = must(await db().from("encounters").select("id,patient_id").eq("id", id).single()) as Pick<Encounter, "id" | "patient_id">;
  must(await db().from("encounters").delete().eq("id", id).select("id"));

  const paths: string[] = [];
  for (const kind of ["video", "document", "vitals"]) {
    const { data } = await db().storage.from(MEDIA_BUCKET).list(`${id}/${kind}`, { limit: 1000 });
    for (const f of data ?? []) paths.push(`${id}/${kind}/${f.name}`);
  }
  if (paths.length) {
    const { error } = await db().storage.from(MEDIA_BUCKET).remove(paths);
    if (error) console.error(`[visits] media for ${id} not removed:`, error.message);
  }

  const p = must(await db().from("patients").select("id,first_name,last_name,encounters(id)").eq("id", enc.patient_id).single()) as Pick<
    Patient,
    "id" | "first_name" | "last_name"
  > & { encounters: { id: string }[] };
  const placeholder = !p.first_name && !p.last_name && p.encounters.length === 0;
  if (placeholder) must(await db().from("patients").delete().eq("id", p.id).select("id"));
  return { deletedPatient: placeholder, mediaRemoved: paths.length };
}

export async function listPatients(q?: string) {
  let query = db()
    .from("patients")
    .select("id,first_name,last_name,date_of_birth,sex,conditions,updated_at,encounters(id,created_at)")
    .not("first_name", "is", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (q) {
    const safe = q.replace(/[%,()]/g, "");
    query = query.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`);
  }
  return must(await query) as unknown as (Pick<Patient, "id" | "first_name" | "last_name" | "date_of_birth" | "sex" | "conditions"> & {
    updated_at: string;
    encounters: { id: string; created_at: string }[];
  })[];
}

export async function getPatient(id: string) {
  return must(await db().from("patients").select("*").eq("id", id).single()) as Patient;
}
