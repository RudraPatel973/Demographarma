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
    insurance: z.object({
      payer: z.string().nullable().describe("Insurance company, e.g. 'Humana', 'Aetna', 'UnitedHealthcare'"),
      plan_name: z.string().nullable().describe("Plan name as said, e.g. 'Humana Medicare Advantage', 'AARP Medicare Rx'"),
      member_id: z.string().nullable(),
      group_number: z.string().nullable(),
      is_medicare: z.boolean().nullable(),
    }),
    medication_history: z
      .array(
        z.object({
          drug: z.string(),
          dose_mg: z.number().nullable(),
          outcome: z.enum(["ongoing", "not_at_goal", "side_effect", "allergy", "stopped_other"]),
          detail: z.string().nullable().describe("e.g. 'dry cough', 'BP still 150s after 2 months'"),
          started_when: z.string().nullable().describe("When it was started, as said: '2 years ago', 'in 2023', 'last March'"),
          stopped_when: z.string().nullable().describe("When it was stopped, as said (null if still taking)"),
        }),
      )
      .describe("Blood-pressure medicines the patient has taken before or takes now, and how it went"),
    conditions: z.array(z.enum(CONDITIONS.map((c) => c.key) as [string, ...string[]])),
    current_medications: z.array(z.string()).describe("'name dose frequency' strings"),
    allergies: z.array(z.string()).describe("'substance - reaction' strings"),
    vitals: z.object({ bp_systolic: num, bp_diastolic: num, heart_rate: num }),
    labs: z.object({ egfr: num, potassium: num, sodium: num, uacr: num }),
    adherence: z.string().nullable().describe("What the patient said about taking their medicines as prescribed, e.g. 'never misses doses', 'uses a pill box'"),
    lifestyle: z.string().nullable().describe("Lifestyle measures mentioned: low-salt diet, exercise, weight loss, alcohol reduction"),
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
- insurance: only what is said (payer, plan name, member/ID number, group number). is_medicare true if Medicare is mentioned.
- medication_history: every blood-pressure medicine mentioned as taken now or before, with the outcome:
  Include when each was started/stopped if said ("two years ago", "in 2023").
  "didn't work / pressure stayed high" -> not_at_goal; ANY unwanted effect the drug caused (cough, swelling of any body part,
  breast/chest enlargement, dizziness, fatigue, high potassium, sexual problems…) -> side_effect, even if it was then stopped;
  hives/rash/face or tongue swelling -> allergy; currently taking and fine -> ongoing; stopped only for cost/convenience -> stopped_other.
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

/** "2 years ago" / "a couple of years ago" / "in 2023" / "last March" / "6 months ago" -> approximate ISO date */
export function approxDate(said: string | null | undefined, now = new Date()): string | null {
  if (!said) return null;
  const t = said.toLowerCase();
  const words: Record<string, number> = { a: 1, an: 1, one: 1, couple: 2, "a couple": 2, two: 2, few: 3, "a few": 3, three: 3, four: 4, five: 5, six: 6, several: 3 };
  const d = new Date(now);
  const m = /(\d+|a couple|couple|a few|few|an|a|one|two|three|four|five|six|several)\s*(?:of\s*)?(year|month|week)s?\s*ago/.exec(t);
  if (m) {
    const n = Number(m[1]) || words[m[1]] || 1;
    if (m[2] === "year") d.setFullYear(d.getFullYear() - n);
    else if (m[2] === "month") d.setMonth(d.getMonth() - n);
    else d.setDate(d.getDate() - 7 * n);
    return d.toISOString().slice(0, 10);
  }
  if (/last year/.test(t)) return `${now.getFullYear() - 1}-01-01`;
  if (/this year/.test(t)) return `${now.getFullYear()}-01-01`;
  const y = /\b(19|20)\d{2}\b/.exec(t);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mi = months.findIndex((mm) => new RegExp(`\\b${mm}`).test(t));
  if (y) return `${y[0]}-${String(mi >= 0 ? mi + 1 : 1).padStart(2, "0")}-01`;
  if (mi >= 0) {
    // "last March" / "since June" = the most recent such month
    const year = mi > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
    return `${year}-${String(mi + 1).padStart(2, "0")}-01`;
  }
  return null;
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
    pu.address = await completeAddress({ ...(patient.address ?? {}), ...addr }, { preferLookupZip: true });
  }
  // Pregnant/breastfeeding implies female if sex wasn't said
  const preg = (pu.pregnancy_status as string | undefined) ?? patient.pregnancy_status;
  if (!pu.sex && !patient.sex && (preg === "pregnant" || preg === "breastfeeding")) pu.sex = "FEMALE";
  pu.conditions = unionCI(patient.conditions, x.conditions);
  pu.current_medications = unionCI(patient.current_medications, x.current_medications);
  pu.allergies = unionCI(patient.allergies, x.allergies);
  pu.updated_at = new Date().toISOString();
  // Insurance: keep what was said; auto-link a plan when the name matches exactly one known plan
  const ins = Object.fromEntries(Object.entries(x.insurance ?? {}).filter(([, v]) => v !== null && v !== ""));
  if (Object.keys(ins).length) {
    const cur = (patient.insurance ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...cur, ...ins };
    if (!cur.plan_id && typeof ins.plan_name === "string" && ins.plan_name.length > 3) {
      const { data: plans } = await db()
        .from("insurance_plans")
        .select("id,name,payer,formulary_id")
        .ilike("name", `%${ins.plan_name.replace(/[%,]/g, "")}%`)
        .limit(60);
      // regional copies of the same plan share one drug list, so any of them gives the right coverage
      if (plans?.length && new Set(plans.map((x) => x.formulary_id)).size === 1) {
        Object.assign(merged, { plan_id: plans[0].id, plan_name: plans[0].name, payer: plans[0].payer ?? merged.payer });
      }
    }
    pu.insurance = merged;
  }

  const newPatient = must(await db().from("patients").update(pu).eq("id", patient.id).select("*").single()) as Patient;

  // Medication history -> trials (feeds step therapy / prior auth); dedupe on drug + outcome
  if (x.medication_history?.length) {
    const meds = must(await db().from("medications").select("id,generic_name")) as { id: string; generic_name: string }[];
    const { data: existing } = await db().from("medication_trials").select("id,drug_name,outcome,source,started_on,ended_on").eq("patient_id", patient.id);
    const key = (d: string) => d.toLowerCase().split(/\s+/)[0];
    const byDrug = new Map((existing ?? []).map((t) => [key(t.drug_name), t]));
    const failed = new Set(["not_at_goal", "side_effect", "allergy"]);
    // Only keep a dose if that number was actually said near the drug's name (models like to fill in "typical" doses)
    const spoken = transcriptText(encounter).toLowerCase();
    const doseSaid = (drug: string, dose: number | null) => {
      if (dose == null) return null;
      const name = drug.toLowerCase().split(/\s+/)[0];
      let i = spoken.indexOf(name);
      while (i !== -1) {
        const window = spoken.slice(i, i + name.length + 60);
        if (new RegExp(`\\b${String(dose).replace(".", "\\.")}\\b`).test(window)) return dose;
        i = spoken.indexOf(name, i + 1);
      }
      return null;
    };
    const rows: Record<string, unknown>[] = [];
    for (const h of x.medication_history) {
      const prev = byDrug.get(key(h.drug));
      if (prev) {
        // same drug heard again with a more specific outcome (e.g. "stopped" -> "side effect"): update it
        const patch: Record<string, unknown> = {};
        if (prev.outcome !== h.outcome && failed.has(h.outcome) && !failed.has(prev.outcome) && prev.source === "transcript") Object.assign(patch, { outcome: h.outcome, detail: h.detail });
        // fill in dates once they're mentioned
        if (h.started_when && !prev.started_on) patch.started_on = approxDate(h.started_when);
        if (h.stopped_when && !prev.ended_on) patch.ended_on = approxDate(h.stopped_when);
        if (Object.keys(patch).length && prev.id) await db().from("medication_trials").update(patch).eq("id", prev.id);
        continue;
      }
      const med = meds.find((m) => m.generic_name.split(" ")[0] === key(h.drug));
      rows.push({
        patient_id: patient.id,
        encounter_id: encounterId,
        medication_id: med?.id ?? null,
        drug_name: h.drug,
        dose_mg: doseSaid(h.drug, h.dose_mg),
        outcome: h.outcome,
        detail: [h.detail, h.started_when ? `started ${h.started_when}` : null, h.stopped_when ? `stopped ${h.stopped_when}` : null].filter(Boolean).join("; ") || null,
        started_on: approxDate(h.started_when),
        ended_on: approxDate(h.stopped_when),
        source: "transcript",
      });
      byDrug.set(key(h.drug), { id: "", drug_name: h.drug, outcome: h.outcome, source: "transcript", started_on: null, ended_on: null });
    }
    if (rows.length) must(await db().from("medication_trials").insert(rows).select("id"));
  }

  // Encounter: vitals/labs, notes, diagnosis
  const clean = (o: Record<string, number | null>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
  const stated = Boolean(x.diagnosis.stated && x.diagnosis.diagnosis_id);
  const vitals = { ...encounter.vitals, ...clean(x.vitals) };
  // A heart rate said in the visit replaces a model-inferred one, so it loses the model provenance
  if (vitals.sources?.heart_rate && vitals.heart_rate !== encounter.vitals.heart_rate) {
    vitals.sources = { ...vitals.sources };
    delete vitals.sources.heart_rate;
  }
  const eu: Record<string, unknown> = {
    vitals,
    labs: { ...encounter.labs, ...clean(x.labs) },
    live_state: {
      ...encounter.live_state,
      notes: x.clinical_notes || encounter.live_state?.notes || "",
      adherence: x.adherence || encounter.live_state?.adherence || null,
      lifestyle: x.lifestyle || encounter.live_state?.lifestyle || null,
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
