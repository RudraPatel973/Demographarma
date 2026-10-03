import "server-only";
import * as z from "zod/v4";
import { db, must } from "./supabase";
import { structured, llmProvider } from "./llm";
import { buildProfile, scoreCandidates, type ModifierRow, type Table1Row } from "./scoring";
import { loadCoverageContext, coverageFor, comboCoverage } from "./coverage-server";
import type { PriceRow } from "./plan";
import type { Diagnosis, Encounter, Medication, MedicationTrial, Patient } from "./types";
import { formatAddress } from "./types";
import { getClinicProfile } from "./clinic";
import { photonPrescriptionInfo, type PhotonRxInfo } from "./photon";
import type { Prescription } from "./types";

/** Real NPIs pass a Luhn check with the 80840 prefix; sandbox placeholders like 0000000000 don't. */
export function validNpi(npi: string | null | undefined) {
  if (!npi || !/^\d{10}$/.test(npi) || /^0+$/.test(npi)) return false;
  const digits = ("80840" + npi).split("").map(Number);
  let sum = 0;
  for (let i = digits.length - 1, dbl = false; i >= 0; i--, dbl = !dbl) {
    let d = digits[i];
    if (dbl) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

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
  /** the prescription this packet is for; defaults to the visit's prescription for the same drug */
  prescriptionId?: string | null;
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
  const scored = scoreCandidates(table1, meds, modifiers, buildProfile(patient, enc), trials);
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

  // What was actually sent through Photon: exact product, sig, quantity, prescriber NPI, pharmacy
  const rxQuery = db().from("prescriptions").select("*").eq("encounter_id", enc.id).order("created_at", { ascending: false });
  const rxRows = ((await (args.prescriptionId ? rxQuery.eq("id", args.prescriptionId) : rxQuery)).data ?? []) as Prescription[];
  const rx =
    rxRows.find((r) => (args.combo ? r.combination_id === args.combo.id : args.medicationId && r.medication_id === args.medicationId)) ??
    (args.prescriptionId ? rxRows[0] : undefined);
  let photon: PhotonRxInfo | null = null;
  if (rx && (rx.photon_prescription_id || rx.photon_order_id || patient.photon_patient_id)) {
    photon = await photonPrescriptionInfo({
      prescriptionId: rx.photon_prescription_id,
      orderId: rx.photon_order_id,
      patientId: patient.photon_patient_id,
      treatmentName: args.combo?.label ?? med?.generic_name ?? null,
    }).catch(() => null);
  }
  const pr = photon?.prescriber;
  const npi = validNpi(clinic.npi) ? clinic.npi : validNpi(pr?.npi) ? pr!.npi : null;
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
      date_of_birth: patient.date_of_birth ?? photon?.patient.date_of_birth ?? null,
      sex: patient.sex ?? photon?.patient.sex?.toLowerCase() ?? null,
      phone: patient.phone ?? photon?.patient.phone ?? null,
      address: formatAddress(patient.address) || photon?.patient.address || null,
    },
    insurance: {
      plan: ctx.planName,
      payer: planRow?.payer ?? patient.insurance?.payer ?? null,
      plan_id: patient.insurance?.plan_id ?? null,
      member_id: patient.insurance?.member_id ?? null,
      // Medicare Part D cards have no employer group number
      group_number: patient.insurance?.group_number ?? (isMedicare || ctx.demoPlan ? "N/A (Medicare Part D)" : null),
    },
    prescriber: {
      name: (() => {
        const n = clinic.prescriber_name || pr?.name;
        return n ? `${n}${clinic.credentials ? `, ${clinic.credentials}` : ""}` : null;
      })(),
      npi,
      practice: clinic.practice_name || null,
      phone: clinic.phone || pr?.phone || null,
      fax: clinic.fax || pr?.fax || null,
      address: clinic.address || pr?.address || null,
      email: clinic.email || pr?.email || null,
    },
    pharmacy: photon?.pharmacy ?? null,
    photon_prescription_id: photon?.prescription_id ?? null,
    adherence: enc.live_state?.adherence ?? null,
    lifestyle: enc.live_state?.lifestyle ?? null,
    medication: {
      name: photon?.medication.name ?? drugLabel,
      strength_mg: args.doseMg ?? rx?.dose_mg ?? null,
      directions: photon?.medication.instructions ?? args.sig ?? rx?.sig ?? null,
      quantity: photon?.medication.quantity ?? args.quantity ?? rx?.dispense_quantity ?? 30,
      unit: photon?.medication.unit ?? null,
      days_supply: photon?.medication.days_supply ?? rx?.days_supply ?? 30,
      refills: photon?.medication.refills ?? (rx?.fills_allowed ? rx.fills_allowed - 1 : null),
      dispense_as_written: photon?.medication.dispense_as_written ?? null,
      date_written: photon?.written_at?.slice(0, 10) ?? rx?.created_at?.slice(0, 10) ?? null,
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
    const p = form.prescriber;
    if (!p.name) m.push("Prescriber name (Settings)");
    if (!p.npi) m.push("Prescriber NPI (Settings — Photon's sandbox NPI isn't a real one)");
    if (!p.phone) m.push("Practice phone (Settings)");
    if (!p.fax) m.push("Practice fax (Settings)");
    if (!p.address) m.push("Practice address (Settings)");
    if (!form.insurance.plan) m.push("Insurance plan (add it in the Insurance panel)");
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

/**
 * After a prescription goes out through Photon: refresh any packet already started for it (so it picks up the signed
 * sig, quantity, NPI and pharmacy), and start one for any drug the plan restricts. Unless `rebuildOnly`.
 */
export async function autoPriorAuth(encounterId: string, opts: { rebuildOnly?: boolean } = {}) {
  const rxs = ((await db().from("prescriptions").select("*").eq("encounter_id", encounterId)).data ?? []) as Prescription[];
  if (!rxs.length) return [];
  const existing = ((await db().from("prior_auths").select("id,medication_id,combination_id,form").eq("encounter_id", encounterId)).data ?? []) as {
    id: string;
    medication_id: string | null;
    combination_id: string | null;
    form: { request?: { combo?: { id: string; product_rxcui: string; label: string } | null } };
  }[];
  const enc = must(await db().from("encounters").select("*").eq("id", encounterId).single()) as Encounter;
  const patient = must(await db().from("patients").select("*").eq("id", enc.patient_id).single()) as Patient;
  const ctx = await loadCoverageContext(patient, enc);
  const meds = must(await db().from("medications").select("*")) as Medication[];
  const prices = must(await db().from("drug_prices").select("rxcui,name,medication_id,combination_id,dose_mg,nadac_per_unit")) as PriceRow[];
  const combos = ((await db().from("combination_products").select("id,product_rxcui,label")).data ?? []) as { id: string; product_rxcui: string; label: string }[];

  const done: string[] = [];
  for (const rx of rxs) {
    const pa = existing.find((e) => (rx.combination_id ? e.combination_id === rx.combination_id : rx.medication_id && e.medication_id === rx.medication_id));
    const combo = rx.combination_id ? combos.find((c) => c.id === rx.combination_id) ?? pa?.form.request?.combo ?? null : null;
    const med = rx.medication_id ? meds.find((m) => m.id === rx.medication_id) : undefined;
    if (!pa) {
      if (opts.rebuildOnly || !ctx.formularyKnown || (!med && !combo)) continue;
      const cov = combo ? comboCoverage(ctx, combo.product_rxcui) : coverageFor(ctx, prices, meds, med!, rx.dose_mg);
      if (cov.status !== "restricted" && cov.status !== "not_covered") continue;
    }
    done.push(
      await buildPriorAuth({
        encounterId,
        medicationId: rx.medication_id,
        doseMg: rx.dose_mg,
        combo,
        sig: rx.sig,
        quantity: rx.dispense_quantity,
        prescriptionId: rx.id,
        existingId: pa?.id,
      }),
    );
  }
  return done;
}
