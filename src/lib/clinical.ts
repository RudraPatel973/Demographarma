import "server-only";
import * as z from "zod/v4";
import { db, must } from "./supabase";
import { loadAttachments, structured, transcriptText } from "./llm";
import { completeAddress } from "./geocode";
import { CONDITIONS, ETHNICITIES, type Diagnosis, type Encounter, type Patient } from "./types";
import type { PatientProfile, ScoredCandidate } from "./scoring";

// ===========================================================================
// 1) Live intake: transcript -> chart, plus "has the doctor stated the diagnosis?"
// ===========================================================================

const num = z.number().nullable();

function intakeSchema(diagnosisIds: [string, ...string[]]) {
  return z.object({
    patient: z.object({
      first_name: z.string().nullable(),
      last_name: z.string().nullable(),
      date_of_birth: z.string().nullable().describe("YYYY-MM-DD, only if a full date was said"),
      age_years: num.describe("If an age was said but no date of birth"),
      sex: z.enum(["MALE", "FEMALE"]).nullable(),
      ethnicity: z.enum(ETHNICITIES.map((e) => e.key) as [string, ...string[]]).nullable(),
      phone: z.string().nullable(),
      email: z.string().nullable(),
      height_cm: num,
      weight_kg: num,
      pregnancy_status: z.enum(["not_pregnant", "childbearing_potential", "pregnant", "breastfeeding"]).nullable(),
    }),
    address: z.object({
      street1: z.string().nullable().describe("House number + street, e.g. '42 Oak St'"),
      street2: z.string().nullable().describe("Apartment / unit, e.g. 'Apt 3B'"),
      city: z.string().nullable(),
      state: z.string().nullable().describe("2-letter US state code, e.g. 'NY'"),
      postalCode: z.string().nullable().describe("5-digit ZIP"),
    }),
    conditions: z.array(z.enum(CONDITIONS.map((c) => c.key) as [string, ...string[]])),
    current_medications: z.array(z.string()).describe("'name dose frequency' strings"),
    allergies: z.array(z.string()).describe("'substance - reaction' strings"),
    vitals: z.object({ bp_systolic: num, bp_diastolic: num, heart_rate: num }),
    labs: z.object({ egfr: num, potassium: num, sodium: num, uacr: num }),
    clinical_notes: z.string().describe("Other things said that matter for choosing a BP drug: past side effects, adherence, cost, pill burden, preferences, symptoms. Empty if none."),
    diagnosis: z.object({
      stated: z.boolean().describe("true only once the DOCTOR has clearly told the patient the diagnosis"),
      diagnosis_id: z.enum(diagnosisIds).nullable(),
      quote: z.string().nullable().describe("The exact words where the doctor states the diagnosis"),
    }),
  });
}
export type Intake = z.infer<ReturnType<typeof intakeSchema>>;

const INTAKE_SYSTEM = `You are a medical scribe listening to a live doctor–patient visit. The transcript comes from browser speech
recognition: no speaker labels, may have errors, and grows as the visit continues.

Extract the patient's chart from everything said so far:
- Only report facts actually stated in the transcript or documents. Use null / [] when not mentioned. Never guess.
- Convert units: feet/inches -> cm, pounds -> kg, "one fifty-four over ninety-five" -> 154/95. Spell out the phone number as digits.
- address: the patient's home address if said. Write numbers as digits ("forty two" -> 42, "one one two oh one" -> 11201),
  abbreviate the street type (Street -> St, Avenue -> Ave), put apartment/unit in street2, state as the 2-letter code
  ("New York" -> NY). If the city is a NYC borough or neighborhood, keep what was said (e.g. Brooklyn). null for parts not said
  (a missing ZIP is looked up automatically). Listen for apartment/unit/floor/suite wherever it's said.
- Names: as the patient said them (fix obvious speech-recognition casing).
- sex: only if stated or unambiguous from context (e.g. "Mr./Mrs.", "my husband" is NOT enough, but pregnancy, tubal ligation,
  prostate, or the doctor saying "she/he" about the patient are).
- conditions: map to the allowed keys only (e.g. "sugar diabetes" -> diabetes, "kidney disease" -> ckd, "AFib" -> afib,
  "my ankles swell" -> edema, "cough on lisinopril" -> acei_cough). If the patient DENIES a condition, leave it out.
- current_medications and allergies: include everything mentioned, including intolerances (e.g. "lisinopril - dry cough").
- diagnosis.stated: true when the DOCTOR tells the patient they have hypertension / high blood pressure, in any wording,
  including casual or hedged ones. COUNTS (true):
    "you have stage 2 hypertension", "I'm diagnosing you with hypertension", "I think you have hypertension",
    "that's high blood pressure", "looks like high blood pressure to me", "your blood pressure is high, we need to treat it",
    "we're going to start you on something for your blood pressure", "this is hypertension".
  DOES NOT COUNT (false): questions ("do you have high blood pressure?"), the patient's or family history ("my mom has
  hypertension", "I was told I had high blood pressure"), just reading a number ("it's 150 over 95"), or deferring
  ("let's recheck before we decide", "it might be white-coat").
  Pick diagnosis_id from context:
    pregnant patient -> pre_existing_hypertension_pregnancy; CKD -> hypertensive_ckd; heart failure -> hypertensive_heart_disease_hf;
    "on three/four medicines and still high" -> resistant_hypertension; aldosterone -> secondary_hypertension_aldosteronism;
    LVH/heart thickening without HF -> hypertensive_heart_disease; otherwise essential_hypertension.`;

export async function extractIntake(encounter: Encounter, patient: Patient, diagnoses: Diagnosis[]) {
  const ids = diagnoses.map((d) => d.id) as [string, ...string[]];
  const attachments = await loadAttachments(encounter);
  const known = {
    first_name: patient.first_name,
    last_name: patient.last_name,
    date_of_birth: patient.date_of_birth,
    sex: patient.sex,
    conditions: patient.conditions,
    current_medications: patient.current_medications,
    allergies: patient.allergies,
  };
  const { data } = await structured({
    speed: "fast",
    system: INTAKE_SYSTEM,
    schema: intakeSchema(ids),
    attachments,
    user:
      `Already on file for this patient (from earlier visits; do not repeat unless restated):\n${JSON.stringify(known)}\n\n` +
      `<transcript>\n${transcriptText(encounter) || "(nothing yet)"}\n</transcript>\n\n` +
      (encounter.patient_text ? `<patient_text>\n${encounter.patient_text}\n</patient_text>` : ""),
  });
  return data;
}

function unionCI(a: string[], b: string[]) {
  const seen = new Map<string, string>();
  for (const s of [...a, ...b].map((x) => x.trim()).filter(Boolean)) {
    const k = s.toLowerCase();
    if (!seen.has(k)) seen.set(k, s);
  }
  return Array.from(seen.values());
}

/** Run extraction on the current transcript and merge it into the patient + encounter rows. */
export async function syncFromTranscript(encounterId: string) {
  const encounter = must(await db().from("encounters").select("*").eq("id", encounterId).single()) as Encounter;
  const patient = must(await db().from("patients").select("*").eq("id", encounter.patient_id).single()) as Patient;
  const diagnoses = must(await db().from("diagnoses").select("*")) as Diagnosis[];
  if (!encounter.transcript?.length && !encounter.documents?.length && !encounter.patient_text) {
    return { patient, encounter, diagnosisStated: false };
  }

  const x = await extractIntake(encounter, patient, diagnoses);
  const p = x.patient;

  // Patient: scalars said in this visit win; lists only grow during a visit.
  const pu: Record<string, unknown> = {};
  for (const k of ["first_name", "last_name", "sex", "ethnicity", "phone", "email", "height_cm", "weight_kg", "pregnancy_status"] as const) {
    if (p[k] !== null && p[k] !== undefined && p[k] !== "") pu[k] = p[k];
  }
  if (p.date_of_birth && /^\d{4}-\d{2}-\d{2}$/.test(p.date_of_birth)) {
    pu.date_of_birth = p.date_of_birth;
    pu.dob_is_estimate = false;
  } else if (p.age_years && (!patient.date_of_birth || patient.dob_is_estimate)) {
    const y = new Date().getFullYear() - Math.round(p.age_years);
    pu.date_of_birth = `${y}-01-01`;
    pu.dob_is_estimate = true;
  }
  const addr = Object.fromEntries(Object.entries(x.address ?? {}).filter(([, v]) => typeof v === "string" && v.trim()));
  if (Object.keys(addr).length) {
    if (typeof addr.state === "string") addr.state = addr.state.toUpperCase().slice(0, 2);
    if (typeof addr.postalCode === "string") addr.postalCode = addr.postalCode.replace(/[^\d-]/g, "");
    // Fill in the ZIP (and city/state) from what was said, e.g. "560 W 163rd St, New York, NY" -> 10032
    pu.address = await completeAddress({ ...(patient.address ?? {}), ...addr });
  }
  pu.conditions = unionCI(patient.conditions, x.conditions);
  pu.current_medications = unionCI(patient.current_medications, x.current_medications);
  pu.allergies = unionCI(patient.allergies, x.allergies);
  pu.updated_at = new Date().toISOString();
  const newPatient = must(await db().from("patients").update(pu).eq("id", patient.id).select("*").single()) as Patient;

  // Encounter: vitals/labs, notes, diagnosis
  const clean = (o: Record<string, number | null>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
  const stated = Boolean(x.diagnosis.stated && x.diagnosis.diagnosis_id);
  const eu: Record<string, unknown> = {
    vitals: { ...encounter.vitals, ...clean(x.vitals) },
    labs: { ...encounter.labs, ...clean(x.labs) },
    live_state: {
      ...encounter.live_state,
      notes: x.clinical_notes || encounter.live_state?.notes || "",
      extracted_at: new Date().toISOString(),
      extracted_segments: encounter.transcript.length,
      ...(stated ? { diagnosis_quote: x.diagnosis.quote ?? undefined } : {}),
    },
    updated_at: new Date().toISOString(),
  };
  if (stated) eu.diagnosis_id = x.diagnosis.diagnosis_id;
  const newEncounter = must(await db().from("encounters").update(eu).eq("id", encounterId).select("*").single()) as Encounter;

  return { patient: newPatient, encounter: newEncounter, diagnosisStated: stated };
}

// ===========================================================================
// 2) Ranking: pick the top 3 of the rule-engine shortlist
// ===========================================================================

const RANK_SYSTEM = `You are a clinical decision-support assistant for hypertension. A licensed clinician reviews and approves
everything you produce; you never prescribe.

You receive the patient's chart (built from the visit audio), the visit transcript, the diagnosis, and a candidate list from
a deterministic rule engine. Each candidate's rule_score = guideline line-of-therapy prior (Table 1) + patient-specific
modifiers (Table 2) with cited rationale.

Pick the 3 best candidates for THIS patient and give each a match_percent (0-100). Use rule_score as a strong prior, but
adjust it for things only said in the visit (past side effects, adherence, cost, pill burden, preferences). Explain why.

Rules:
- Only use medication_id values from the candidate list. Contraindicated drugs were already removed.
- Follow the 2025 AHA/ACC guideline: first-line classes are thiazide/thiazide-like diuretics, ACE inhibitors, ARBs and
  dihydropyridine CCBs, chosen race-neutrally unless there's a compelling indication. Ethnicity only matters where it changes
  a documented safety risk (e.g. ACE-inhibitor angioedema) or a specifically indicated therapy.
  Never write that a drug is "more effective" or "preferred" because of the patient's race or ethnicity.
- If the transcript reveals a contraindication, allergy, pregnancy or lab value missing from the chart, treat it as true and
  list it in safety_flags.
- Doses must be inside the usual range; start low at age ≥65 or reduced eGFR; prefer a strength in available_strengths.
  sig must be patient-readable. Default 30-day supply, 3 fills.
- For stage 2 (≥140/90), say in combination_note that the guideline prefers two first-line classes, ideally one combination pill.
- factors_for / factors_against: short patient-specific bullets (≤12 words each).
- Return exactly 3 recommendations with distinct match_percent values in descending order.`;

function rankSchema(candidateIds: [string, ...string[]]) {
  return z.object({
    clinical_summary: z.string(),
    recommendations: z.array(
      z.object({
        medication_id: z.enum(candidateIds),
        match_percent: z.number(),
        summary: z.string(),
        rationale: z.string(),
        factors_for: z.array(z.string()),
        factors_against: z.array(z.string()),
        dose_mg: z.number(),
        sig: z.string(),
        dispense_quantity: z.number(),
        days_supply: z.number(),
        fills_allowed: z.number(),
        monitoring: z.string(),
      }),
    ),
    combination_note: z.string().nullable(),
    safety_flags: z.array(z.string()),
  });
}

export async function rankCandidates(args: {
  patient: Patient;
  profile: PatientProfile;
  encounter: Encounter;
  diagnosis: Diagnosis;
  candidates: ScoredCandidate[];
  excluded: ScoredCandidate[];
  missing: string[];
  /** When ranking the second pill: the drug(s) it will be combined with */
  pairWith?: { name: string; drug_class: string; dose_mg: number | null; already_taking: boolean }[];
  plan?: { mode: string; reason: string };
}) {
  const { patient, profile, encounter, diagnosis, candidates, excluded, missing, pairWith, plan } = args;
  const context = {
    patient: {
      age: profile.age,
      sex: patient.sex,
      ethnicity: patient.ethnicity,
      height_cm: patient.height_cm,
      weight_kg: patient.weight_kg,
      bmi: profile.bmi,
      pregnancy_status: patient.pregnancy_status,
      conditions: patient.conditions,
      current_medications: patient.current_medications,
      allergies: patient.allergies,
    },
    vitals: encounter.vitals,
    labs: encounter.labs,
    missing_inputs: missing,
    visit_notes: encounter.live_state?.notes ?? null,
    diagnosis: { ...diagnosis, doctor_said: encounter.live_state?.diagnosis_quote ?? null, clinician_notes: encounter.diagnosis_notes },
    candidates: candidates.map((c) => ({
      medication_id: c.medication.id,
      name: c.medication.generic_name,
      class: c.medication.drug_class,
      line_of_therapy: c.line_of_therapy,
      rule_score: c.rule_score,
      modifiers: c.fired.map((f) => ({ delta: f.delta, matched: f.matched, why: f.rationale })),
      usual_dose_mg: [c.medication.usual_dose_min_mg, c.medication.usual_dose_max_mg],
      start_dose_mg: c.medication.start_dose_mg,
      start_dose_elderly_mg: c.medication.start_dose_elderly_mg,
      doses_per_day: c.medication.doses_per_day,
      available_strengths: c.medication.available_strengths.slice(0, 8),
      monitoring: c.medication.monitoring,
      cost_tier: c.medication.cost_tier,
    })),
    excluded_by_rules: excluded.map((c) => c.medication.id),
    treatment_plan: plan ?? null,
    combine_with: pairWith ?? null,
  };
  const ids = candidates.map((c) => c.medication.id) as [string, ...string[]];
  return structured({
    speed: "deep",
    system: RANK_SYSTEM,
    schema: rankSchema(ids),
    attachments: await loadAttachments(encounter),
    user:
      `<transcript>\n${transcriptText(encounter) || "(none)"}\n</transcript>\n\n` +
      `<structured_context>\n${JSON.stringify(context)}\n</structured_context>\n\n` +
      (pairWith?.length
        ? `This is the SECOND drug for a two-drug regimen. It will be taken together with: ${pairWith.map((p) => `${p.name}${p.dose_mg ? ` ${p.dose_mg} mg` : ""} (${p.drug_class})${p.already_taking ? " which the patient already takes" : ""}`).join(" + ")}. ` +
          `Rank the best complementary drugs for this patient (candidates already exclude unsafe pairings; candidates' modifiers include the pairing bonus). ` +
          `Choose doses suitable for combination therapy (usually starting doses). Do not repeat the guideline note about combination therapy. Return the top 3.`
        : plan?.mode === "dual"
          ? "This is the FIRST of two drugs (stage 2: a second, complementary drug will be chosen next). Rank the best first drug; prefer ones that pair well. Return the top 3."
          : "Return the top 3 for this patient."),
  });
}
