import "server-only";
import { db } from "./supabase";
import { entriesFor, evaluateCoverage, type FormularyEntry, type Trial } from "./coverage";
import type { PriceRow } from "./plan";
import type { Encounter, Medication, Patient } from "./types";

/** Everything needed to judge coverage for one patient: their plan, its drug list, and what they've tried. */
export async function loadCoverageContext(patient: Patient, encounter?: Pick<Encounter, "vitals"> | null) {
  const planId = patient.insurance?.plan_id ?? null;
  const planNameSaid = patient.insurance?.plan_name ?? patient.insurance?.payer ?? null;
  type PlanRow = { id: string; name: string; formulary_id: string | null; tier_costs: Record<string, { type: string; amount: number }> | null };
  const COLS = "id,name,formulary_id,tier_costs";
  let plan: PlanRow | null = null;
  if (planId) plan = (await db().from("insurance_plans").select(COLS).eq("id", planId).maybeSingle()).data;
  // Demo: no linked plan is never a dead end. Use the closest plan to what the patient said, else a default drug list.
  let demoPlan = false;
  if (!plan?.formulary_id) {
    const words = (planNameSaid ?? "").replace(/[%,()]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(plan|the|and|medicare|insurance|health)$/i.test(w));
    for (const w of words) {
      plan = (await db().from("insurance_plans").select(COLS).ilike("name", `%${w}%`).not("formulary_id", "is", null).limit(1).maybeSingle()).data;
      if (plan) break;
    }
    if (!plan) plan = (await db().from("insurance_plans").select(COLS).eq("id", process.env.DEMO_PLAN_ID || "S5820-034-000").maybeSingle()).data;
    demoPlan = Boolean(plan);
  }
  const entries = plan?.formulary_id
    ? (((await db().from("formulary_entries").select("*").eq("formulary_id", plan.formulary_id)).data ?? []) as FormularyEntry[])
    : [];
  const trials = (((await db().from("medication_trials").select("*").eq("patient_id", patient.id)).data ?? []) as Trial[]);
  const sbp = encounter?.vitals?.bp_systolic ?? 0;
  const dbp = encounter?.vitals?.bp_diastolic ?? 0;
  return { planName: demoPlan ? planNameSaid ?? plan?.name ?? null : plan?.name ?? planNameSaid, demoPlan, demoPlanName: demoPlan ? plan?.name ?? null : null, formularyKnown: Boolean(plan?.formulary_id), entries, trials, tierCosts: plan?.tier_costs ?? null, aboveGoal: sbp >= 130 || dbp >= 80 };
}

export type CoverageContext = Awaited<ReturnType<typeof loadCoverageContext>>;

/** Covered, unrestricted (tier <= 2, no PA/ST) alternatives among the drugs that are safe for this patient. */
export function preferredAlternatives(ctx: CoverageContext, prices: PriceRow[], safe: Medication[], exclude: Medication) {
  if (!ctx.formularyKnown) return [];
  const alreadyTried = new Set(ctx.trials.map((t) => t.medication_id).filter(Boolean));
  const ok = safe.filter((m) => {
    if (m.id === exclude.id || alreadyTried.has(m.id)) return false;
    const rows = entriesFor(ctx.entries, prices, { medicationId: m.id });
    return rows.some((r) => !r.prior_auth && !r.step_therapy && (r.tier ?? 9) <= 2);
  });
  // same class first, then other first-line classes
  const first = ["thiazide", "acei", "arb", "ccb_dhp"];
  return ok
    .sort((a, b) => Number(b.class_key === exclude.class_key) - Number(a.class_key === exclude.class_key) || Number(first.includes(b.class_key)) - Number(first.includes(a.class_key)))
    .map((m) => m.generic_name);
}

export function coverageFor(ctx: CoverageContext, prices: PriceRow[], safe: Medication[], med: Medication, doseMg: number | null) {
  return evaluateCoverage({
    planName: ctx.planName,
    formularyKnown: ctx.formularyKnown,
    rows: entriesFor(ctx.entries, prices, { medicationId: med.id, doseMg }),
    med,
    trials: ctx.trials,
    preferredAlternatives: preferredAlternatives(ctx, prices, safe, med),
    tierCosts: ctx.tierCosts,
    aboveGoal: ctx.aboveGoal,
  });
}

export function comboCoverage(ctx: CoverageContext, comboRxcui: string, trials = ctx.trials) {
  return evaluateCoverage({
    planName: ctx.planName,
    formularyKnown: ctx.formularyKnown,
    rows: entriesFor(ctx.entries, [], { comboRxcui }),
    trials,
    preferredAlternatives: ["the two generic components"],
    tierCosts: ctx.tierCosts,
    aboveGoal: ctx.aboveGoal,
  });
}
