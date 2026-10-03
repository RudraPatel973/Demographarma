import type { Medication } from "./types";
import type { PriceRow } from "./plan";

/**
 * Insurance coverage for a drug on the patient's plan, and how it nudges the match %.
 * Clinical fit stays primary: the coverage adjustment is capped at +/-15 so it only reorders close options.
 */

export interface FormularyEntry {
  formulary_id: string;
  rxcui: string;
  medication_id: string | null;
  combination_id: string | null;
  tier: number | null;
  prior_auth: boolean;
  step_therapy: boolean;
  quantity_limit: string | null;
}

export interface Trial {
  medication_id: string | null;
  drug_name: string;
  outcome: "ongoing" | "not_at_goal" | "side_effect" | "allergy" | "contraindicated" | "stopped_other";
  detail: string | null;
  dose_mg: number | null;
  started_on: string | null;
  ended_on: string | null;
}

export interface Coverage {
  status: "unknown" | "covered" | "restricted" | "not_covered";
  cost_text?: string | null;
  plan_name?: string;
  tier?: number | null;
  prior_auth?: boolean;
  step_therapy?: boolean;
  quantity_limit?: string | null;
  step_met?: boolean;
  pa_criteria_met?: boolean;
  exception_eligible?: boolean;
  adjustment: number;
  label: string;
  notes: string[];
}

const FIRST_LINE = ["thiazide", "acei", "arb", "ccb_dhp"];
const FAILED = new Set(["not_at_goal", "side_effect", "allergy", "contraindicated"]);
const CAP = 15;

/** Formulary rows for one drug strength (or any strength of the drug as a fallback). */
export function entriesFor(entries: FormularyEntry[], prices: PriceRow[], opts: { medicationId?: string; doseMg?: number | null; comboRxcui?: string }) {
  if (opts.comboRxcui) return entries.filter((e) => e.rxcui === opts.comboRxcui);
  const strengthRxcuis = prices
    .filter((p) => p.medication_id === opts.medicationId && (opts.doseMg == null || Number(p.dose_mg) === Number(opts.doseMg)))
    .map((p) => p.rxcui);
  const exact = entries.filter((e) => strengthRxcuis.includes(e.rxcui));
  return exact.length ? exact : entries.filter((e) => e.medication_id === opts.medicationId);
}

export function evaluateCoverage(args: {
  planName: string | null;
  formularyKnown: boolean;
  rows: FormularyEntry[];
  med?: Pick<Medication, "id" | "class_key" | "generic_name">;
  trials: Trial[];
  /** covered alternatives without PA/step therapy (tier <= 2) that are safe for this patient */
  preferredAlternatives: string[];
  tierCosts?: Record<string, { type: string; amount: number }> | null;
  /** BP above goal today: drugs the patient is currently taking count as "tried, not at goal" */
  aboveGoal?: boolean;
}): Coverage {
  const { planName, formularyKnown, rows, med, trials, preferredAlternatives, tierCosts, aboveGoal } = args;
  if (!planName) return { status: "unknown", adjustment: 0, label: "No insurance on file", notes: [] };
  if (!formularyKnown) return { status: "unknown", plan_name: planName, adjustment: 0, label: "Coverage checked in Photon", notes: [] };
  if (!rows.length) {
    return {
      status: "not_covered",
      plan_name: planName,
      adjustment: -15,
      label: "Not on this plan's drug list",
      notes: ["Needs a formulary exception, or choose a covered alternative."],
    };
  }
  // best (least restrictive) listing among strengths/forms
  const best = [...rows].sort((a, b) => Number(a.prior_auth) + Number(a.step_therapy) - (Number(b.prior_auth) + Number(b.step_therapy)) || (a.tier ?? 9) - (b.tier ?? 9))[0];
  const tier = best.tier;
  const failed = trials
    .filter((t) => (FAILED.has(t.outcome) || (aboveGoal && t.outcome === "ongoing")) && t.medication_id !== med?.id)
    .map((t) => (t.outcome === "ongoing" ? { ...t, outcome: "not_at_goal" as const, detail: t.detail ?? "currently taking, BP still above goal" } : t));
  const failedFirstLine = failed.filter((t) => t.medication_id); // matched to our drug list
  const notes: string[] = [];

  // Step therapy: met when another antihypertensive was already tried and failed (documented)
  const stepMet = best.step_therapy ? failedFirstLine.length > 0 || failed.length > 0 : undefined;
  // Exception: every preferred same-class alternative is contraindicated for this patient
  // (preferredAlternatives already excludes anything contraindicated for this patient)
  const exceptionEligible = Boolean(best.step_therapy || best.prior_auth) && preferredAlternatives.length === 0;
  // PA criteria: documented failure of an alternative, or a reason alternatives can't be used
  const paMet = best.prior_auth ? failed.length > 0 || exceptionEligible : undefined;

  let adj = 0;
  if (tier != null) adj += tier <= 1 ? 5 : tier === 2 ? 0 : -5;
  if (best.prior_auth) adj += paMet ? -2 : -10;
  if (best.step_therapy) adj += stepMet ? 0 : -20;
  adj = Math.max(-CAP, Math.min(CAP, adj));

  if (best.step_therapy && !stepMet) {
    notes.push(
      preferredAlternatives.length
        ? `Step therapy: plan wants ${preferredAlternatives.slice(0, 2).join(" or ")} tried first.`
        : "Step therapy: plan wants a preferred drug tried first.",
    );
  }
  if (best.step_therapy && stepMet) notes.push(`Step therapy met: ${failed.map((t) => `${t.drug_name} (${t.outcome.replace(/_/g, " ")})`).join(", ")}.`);
  if (best.prior_auth) notes.push(paMet ? "Prior authorization needed — criteria documented; packet can be generated." : "Prior authorization needed — no failed alternative documented yet.");
  if (exceptionEligible) notes.push("Eligible for a step-therapy exception (no usable preferred alternative).");
  if (best.quantity_limit) notes.push(`Quantity limit: ${best.quantity_limit}.`);

  const restricted = best.prior_auth || best.step_therapy;
  const cost = tier != null ? tierCosts?.[String(tier)] : undefined;
  const costText = cost ? (cost.type === "coinsurance" ? `${Math.round(cost.amount * 100)}% coinsurance` : `$${cost.amount} copay`) : null;
  const label = [
    tier != null ? `Tier ${tier}` : "Covered",
    costText,
    best.prior_auth ? (paMet ? "PA (criteria met)" : "PA required") : null,
    best.step_therapy ? (stepMet ? "step therapy met" : "step therapy") : null,
    !restricted ? "no PA" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    status: restricted ? "restricted" : "covered",
    plan_name: planName,
    tier,
    prior_auth: best.prior_auth,
    step_therapy: best.step_therapy,
    quantity_limit: best.quantity_limit,
    cost_text: costText,
    step_met: stepMet,
    pa_criteria_met: paMet,
    exception_eligible: exceptionEligible,
    adjustment: adj,
    label,
    notes,
  };
}

export { FIRST_LINE };

/** Clinical-fit lead (points) that coverage alone may not overturn. */
export const CLINICAL_LEAD = 10;

/**
 * Coverage breaks near-ties; it never overrides a clearly better clinical fit. When a drug leads another by more than
 * CLINICAL_LEAD clinical points but its coverage penalty would drop it below, keep it 3 points ahead (the paperwork is
 * one click away). Mutates match_percent; returns the ids that were held up.
 */
export function keepClinicalLead<T extends { medication_id: string; match_percent: number; clinical_percent?: unknown }>(rows: T[]) {
  const held: string[] = [];
  const byClinical = [...rows].sort((a, b) => Number(b.clinical_percent ?? b.match_percent) - Number(a.clinical_percent ?? a.match_percent));
  for (let pass = 0; pass < rows.length; pass++) {
    for (const a of byClinical) {
      const ca = Number(a.clinical_percent ?? a.match_percent);
      for (const b of rows) {
        if (a === b || ca - Number(b.clinical_percent ?? b.match_percent) <= CLINICAL_LEAD || a.match_percent > b.match_percent + 2) continue;
        a.match_percent = Math.min(ca, 99, b.match_percent + 3);
        if (!held.includes(a.medication_id)) held.push(a.medication_id);
      }
    }
  }
  return held;
}
