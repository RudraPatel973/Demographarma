import "server-only";
import * as z from "zod/v4";
import { db, must } from "./supabase";
import { structured, llmProvider } from "./llm";
import { buildProfile, scoreCandidates, type ModifierRow, type Table1Row } from "./scoring";
import { loadCoverageContext, coverageFor, comboCoverage } from "./coverage-server";
import type { PriceRow } from "./plan";
import type { Diagnosis, Encounter, Medication, MedicationTrial, Patient } from "./types";
import { formatAddress } from "./types";
import { clinicMissing, getClinicProfile } from "./clinic";

/**
 * Builds a prior-authorization / step-therapy-exception packet from the chart:
 * the structured form an insurer asks for + a letter of medical necessity written only from documented facts.
 */
export async function buildPriorAuth(args: {
  encounterId: string;
  medicationId?: string | null;
  doseMg?: number | null;
  combo?: { id: string; product_rxcui: string; label: string } | null;
  sig?: string | null;
  quantity?: number | null;
  /** rebuild an existing packet in place */
  existingId?: string;
}) {
  const enc = must(await db().from("encounters").select("*").eq("id", args.encounterId).single()) as Encounter;
  const patient = must(await db().from("patients").select("*").eq("id", enc.patient_id).single()) as Patient;
  const dx = must(await db().from("diagnoses").select("*").eq("id", enc.diagnosis_id ?? "essential_hypertension").single()) as Diagnosis;
  const meds = must(await db().from("medications").select("*")) as Medication[];
  const med = args.medicationId ? meds.find((m) => m.id === args.medicationId) ?? null : null;
  const prices = must(await db().from("drug_prices").select("rxcui,name,medication_id,combination_id,dose_mg,nadac_per_unit")) as PriceRow[];
  const trials = must(await db().from("medication_trials").select("*").eq("patient_id", patient.id).order("created_at")) as MedicationTrial[];
  const visits = must(await db().from("encounters").select("created_at,vitals").eq("patient_id", patient.id).order("created_at")) as Pick<Encounter, "created_at" | "vitals">[];

  // Why preferred alternatives can't be used: the rule engine's contraindications for this patient
  const table1 = must(await db().from("diagnosis_medications").select("medication_id,line_of_therapy,base_score,guideline,notes").eq("diagnosis_id", dx.id)) as Table1Row[];
  const modifiers = must(await db().from("demographic_modifiers").select("*").eq("active", true)) as ModifierRow[];
  const scored = scoreCandidates(table1, meds, modifiers, buildProfile(patient, enc));
  // leave out the requested drug and anything the patient is currently taking
  const current = patient.current_medications.join(" ").toLowerCase();
  const takingNow = new Set([
    ...trials.filter((t) => t.outcome === "ongoing" || (!t.ended_on && t.outcome === "not_at_goal")).map((t) => t.medication_id),
    ...meds.filter((m) => current.includes(m.generic_name.split(" ")[0])).map((m) => m.id),
  ]);
  const relevant = scored.filter((c) => c.medication.id !== args.medicationId && !takingNow.has(c.medication.id));
  const contraindications = relevant
    .filter((c) => c.contraindicated)
    .map((c) => ({ drug: c.medication.generic_name, class: c.medication.drug_class, reason: c.fired.filter((f) => f.effect === "contraindicated").map((f) => f.rationale).join(" "), source: c.fired.find((f) => f.effect === "contraindicated")?.source ?? null }));
  const cautions = relevant
    .filter((c) => !c.contraindicated && c.fired.some((f) => f.delta <= -20))
    .map((c) => ({ drug: c.medication.generic_name, reason: c.fired.filter((f) => f.delta <= -20).map((f) => f.rationale).join(" ") }));

  const ctx = await loadCoverageContext(patient, enc);
  const coverage = args.combo
    ? comboCoverage(ctx, args.combo.product_rxcui)
    : med
      ? coverageFor(ctx, prices, scored.filter((c) => !c.contraindicated).map((c) => c.medication), med, args.doseMg ?? null)
      : null;
  const clinic = await getClinicProfile();
  const { data: planRow } = patient.insurance?.plan_id
    ? await db().from("insurance_plans").select("plan_type,payer").eq("id", patient.insurance.plan_id).maybeSingle()
    : { data: null };
  const isMedicare = planRow ? ["PDP", "MA-PD"].includes(planRow.plan_type) : Boolean(patient.insurance?.is_medicare);
  const fmtDate = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" }) : null);
  const requestType = coverage?.step_therapy && !coverage.prior_auth ? "step_therapy_exception" : coverage?.status === "not_covered" ? "formulary_exception" : "prior_authorization";
  const drugLabel = args.combo?.label ?? `${med?.generic_name ?? "medication"}${args.doseMg ? ` ${args.doseMg} mg` : ""}`;

  const form = {
    request_type: requestType,
    // what was asked for, so the packet can be rebuilt after the clinician fills gaps
    request: { medication_id: args.medicationId ?? null, dose_mg: args.doseMg ?? null, combo: args.combo ?? null, sig: args.sig ?? null, quantity: args.quantity ?? null },
    patient: {
      name: [patient.first_name, patient.last_name].filter(Boolean).join(" "),
      date_of_birth: patient.date_of_birth,
      sex: patient.sex,
      phone: patient.phone,
      address: formatAddress(patient.address),
    },
    insurance: {
      plan: ctx.planName,
      payer: planRow?.payer ?? patient.insurance?.payer ?? null,
      plan_id: patient.insurance?.plan_id ?? null,
      member_id: patient.insurance?.member_id ?? null,
      // Medicare Part D cards have no employer group number
      group_number: patient.insurance?.group_number ?? (isMedicare ? "N/A (Medicare Part D)" : null),
    },
    prescriber: {
      name: clinic.prescriber_name ? `${clinic.prescriber_name}${clinic.credentials ? `, ${clinic.credentials}` : ""}` : null,
      npi: clinic.npi || null,
      practice: clinic.practice_name || null,
      phone: clinic.phone || null,
      fax: clinic.fax || null,
      address: clinic.address || null,
      email: clinic.email || null,
    },
    adherence: enc.live_state?.adherence ?? null,
    lifestyle: enc.live_state?.lifestyle ?? null,
    medication: {
      name: drugLabel,
      strength_mg: args.doseMg ?? null,
      directions: args.sig ?? null,
      quantity: args.quantity ?? 30,
      days_supply: 30,
      formulary_status: coverage?.label ?? "unknown",
    },
    diagnosis: { icd10: dx.icd10, name: dx.name },
    blood_pressure_readings: visits.filter((v) => v.vitals?.bp_systolic).map((v) => ({ date: v.created_at.slice(0, 10), bp: `${v.vitals.bp_systolic}/${v.vitals.bp_diastolic}`, heart_rate: v.vitals.heart_rate ?? null })),
    labs: enc.labs,
    medications_tried: trials
      .filter((t) => t.outcome !== "ongoing" || t.medication_id !== args.medicationId)
      .map((t) => ({
        drug: t.drug_name,
        dose_mg: t.dose_mg,
        trial_id: (t as MedicationTrial).id,
        start: fmtDate(t.started_on) ? `~${fmtDate(t.started_on)}` : null,
        end:
          t.outcome === "ongoing" || (t.outcome === "not_at_goal" && !t.ended_on && takingNow.has(t.medication_id))
            ? "current"
            : fmtDate(t.ended_on) && fmtDate(t.ended_on) !== fmtDate(t.started_on)
              ? `~${fmtDate(t.ended_on)}`
              : null,
        outcome: t.outcome === "ongoing" && (enc.vitals?.bp_systolic ?? 0) >= 130 ? "taking — BP not at goal" : t.outcome.replace(/_/g, " "),
        detail: t.detail,
      })),
    contraindicated_alternatives: contraindications,
    other_alternatives_unsuitable: cautions,
    allergies: patient.allergies,
    conditions: patient.conditions,
    criteria: coverage?.notes ?? [],
    current_medications_as_documented: patient.current_medications,
    requested_drug_label: med
      ? {
          source: med.dailymed_url,
          indications: (med as Medication & { label_indications?: string | null }).label_indications ?? null,
          contraindications: med.label_contraindications,
        }
      : null,
    citable_sources: [
      "2025 AHA/ACC High Blood Pressure Guideline",
      "2017 ACC/AHA High Blood Pressure Guideline",
      "AGS Beers Criteria 2023",
      "PATHWAY-2 trial (Lancet 2015)",
      "ONTARGET (NEJM 2008) / VA NEPHRON-D (NEJM 2013)",
      "FDA prescribing information for the requested drug",
    ],
  };

  let letter: string | null = null;
  let model: string | null = null;
  if (llmProvider()) {
    const out = await structured({
      speed: "deep",
      system:
        "You write prior-authorization letters of medical necessity for a prescribing clinician to review and sign. " +
        "Use ONLY the facts in the provided form data: never invent dates, doses, readings, trials or outcomes. " +
        "A dose of null means the dose is unknown: name the drug WITHOUT a dose (or write [dose]). Doses for current medications may be " +
        "taken only from current_medications_as_documented. Cite only sources listed in citable_sources, with the exact name and year shown. " +
        "Never list the requested drug as unsuitable. Statements about FDA labeling must come only from requested_drug_label. " +
        "Do not write placeholders like [missing] or [Physician Name]: if a fact isn't provided, leave it out (except unknown doses: [dose]). " +
        "Address it to the payer/plan given. Use the prescriber block for the signature (name, credentials, NPI, practice, phone, fax). " +
        "Mention adherence and lifestyle measures if provided. Dates marked with ~ are approximate; keep the ~. " +
        "Be concise, factual and professional (US letter style, ~250-350 words). Structure: request; diagnosis and BP history; " +
        "prior therapies tried and why they failed or can't be used; why the requested drug is medically necessary for this patient " +
        "(cite the guideline/FDA sources given); request for approval; signature block.",
      schema: z.object({ letter: z.string(), missing_items: z.array(z.string()) }),
      user: `<form_data>\n${JSON.stringify(form, null, 2)}\n</form_data>\nWrite the ${requestType.replace(/_/g, " ")} letter for ${drugLabel}.`,
    });
    model = out.model;
    // Guardrail: never let the letter state a dose that was never documented
    const documented = patient.current_medications.join(" ").toLowerCase();
    const missingItems: string[] = [];
    let text = out.data.letter;
    for (const t of trials) {
      if (t.dose_mg != null) continue;
      const name = t.drug_name.split(/\s+/)[0];
      const re = new RegExp(`(${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s+\\d+(?:\\.\\d+)?\\s*mg`, "gi");
      const doseSaid = new RegExp(`${name}\\s+\\d`, "i").test(documented);
      if (!doseSaid && re.test(text)) {
        text = text.replace(re, "$1 [dose]");
        missingItems.push(`Dose of ${name}`);
      }
    }
    letter = text;
    (form as Record<string, unknown>).missing_items = Array.from(new Set(missingItems));
  }
  {
    // What's genuinely still unknown (computed from the data, not guessed)
    const m = ((form as Record<string, unknown>).missing_items as string[] | undefined) ?? [];
    m.push(...clinicMissing(clinic));
    if (!form.insurance.member_id) m.push("Member ID (ask the patient or read the card)");
    for (const t of form.medications_tried) if (!t.start) m.push(`When ${t.drug} was started`);
    if (!form.adherence) m.push("Adherence statement (ask: do you ever miss doses?)");
    (form as Record<string, unknown>).missing_items = Array.from(new Set(m));
  }

  const record = {
        encounter_id: enc.id,
        patient_id: patient.id,
        medication_id: med?.id ?? null,
        combination_id: args.combo?.id ?? null,
        drug_label: drugLabel,
        plan_id: patient.insurance?.plan_id ?? null,
        plan_name: ctx.planName,
        request_type: requestType,
    form,
    letter,
    model,
  };
  if (args.existingId) {
    must(await db().from("prior_auths").update({ ...record, updated_at: new Date().toISOString() }).eq("id", args.existingId).select("id"));
    return args.existingId;
  }
  const row = must(await db().from("prior_auths").insert(record).select("id").single()) as { id: string };
  return row.id;
}
