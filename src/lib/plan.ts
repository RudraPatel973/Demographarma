import type { Medication } from "./types";
import type { PatientProfile, ScoredCandidate } from "./scoring";

/**
 * Treatment plan: one pill, two pills (dual therapy), or an add-on to what the patient already takes.
 * 2025 AHA/ACC: stage 2 hypertension (>=140/90) -> start two first-line drugs of different classes,
 * preferably as a single-pill combination.
 */

export type PlanMode = "single" | "dual" | "add_on";

export const BP_CLASSES = [
  "acei", "arb", "ccb_dhp", "ccb_nondhp", "thiazide", "loop", "mra", "k_sparing",
  "beta_blocker", "alpha_blocker", "central_alpha", "vasodilator", "renin_inhibitor",
];

export const CLASS_LABEL: Record<string, string> = {
  acei: "ACE inhibitor",
  arb: "ARB",
  ccb_dhp: "calcium channel blocker",
  ccb_nondhp: "non-DHP calcium channel blocker",
  thiazide: "thiazide diuretic",
  loop: "loop diuretic",
  mra: "MRA",
  k_sparing: "potassium-sparing diuretic",
  beta_blocker: "beta blocker",
  alpha_blocker: "alpha blocker",
  central_alpha: "central alpha agonist",
  vasodilator: "vasodilator",
  renin_inhibitor: "renin inhibitor",
};

export function decidePlan(p: PatientProfile, diagnosisId: string) {
  const current = BP_CLASSES.filter((c) => p.medTags.has(c));
  const sbp = p.bp_systolic ?? 0;
  const dbp = p.bp_diastolic ?? 0;
  if (diagnosisId === "pre_existing_hypertension_pregnancy" || p.pregnancy === "pregnant") {
    return { mode: "single" as PlanMode, reason: "Pregnancy: start one agent (labetalol or nifedipine) and titrate.", current };
  }
  if (current.length) {
    if (sbp >= 130 || dbp >= 80) {
      return {
        mode: "add_on" as PlanMode,
        reason: `Already on ${current.map((c) => CLASS_LABEL[c] ?? c).join(" + ")} and still above goal (<130/80): add a second drug from a complementary class.`,
        current,
      };
    }
    return { mode: "single" as PlanMode, reason: "Already treated and at goal.", current };
  }
  if (sbp >= 140 || dbp >= 90) {
    return {
      mode: "dual" as PlanMode,
      reason: `Stage 2 hypertension (${sbp}/${dbp}): the 2025 AHA/ACC guideline recommends starting two first-line drugs of different classes, ideally as one combination pill.`,
      current,
    };
  }
  return { mode: "single" as PlanMode, reason: "Stage 1 hypertension: start one first-line drug.", current };
}

// ---------------------------------------------------------------------------
// Pairing: which second drug goes with the first
// ---------------------------------------------------------------------------
const key = (a: string, b: string) => [a, b].sort().join("+");
const RAAS = ["acei", "arb"];

/** Combinations that must not be started together. */
export function pairBlocked(a: string, b: string): string | null {
  if (a === b) return "same drug class";
  const k = key(a, b);
  if (k === key("acei", "arb")) return "dual RAAS blockade (ACE inhibitor + ARB) raises potassium and kidney-injury risk";
  if (RAAS.includes(a) && b === "renin_inhibitor" || RAAS.includes(b) && a === "renin_inhibitor") return "dual RAAS blockade with aliskiren";
  if (k === key("beta_blocker", "ccb_nondhp")) return "beta blocker + verapamil/diltiazem: heart block and bradycardia";
  if (k === key("mra", "k_sparing")) return "two potassium-sparing drugs: hyperkalemia";
  if (k === key("beta_blocker", "central_alpha")) return "beta blocker + clonidine: rebound hypertension risk";
  return null;
}

/** Guideline-preferred pairs get a bonus (ACCOMPLISH showed ACEi/ARB + CCB is the strongest pairing). */
export function pairBonus(a: string, b: string) {
  const k = key(a, b);
  if (k === key("acei", "ccb_dhp") || k === key("arb", "ccb_dhp")) return { bonus: 12, why: "Preferred pairing: RAAS blocker + calcium channel blocker (best outcomes in ACCOMPLISH)." };
  if (k === key("acei", "thiazide") || k === key("arb", "thiazide")) return { bonus: 10, why: "Preferred pairing: RAAS blocker + thiazide; the diuretic offsets potassium rise." };
  if (k === key("ccb_dhp", "thiazide")) return { bonus: 8, why: "Recommended pairing: calcium channel blocker + thiazide." };
  if (k === key("beta_blocker", "ccb_dhp")) return { bonus: 3, why: "Acceptable pairing: beta blocker + dihydropyridine CCB." };
  if (b === "mra" || a === "mra") return { bonus: 0, why: "MRA add-on (usually reserved for resistant hypertension)." };
  return { bonus: 0, why: "" };
}

/** Score candidates for the second pill given the first pill's class(es). */
export function scoreSecondPill(eligible: ScoredCandidate[], firstClasses: string[], comboPartners: Set<string>) {
  const out: (ScoredCandidate & { pair_bonus: number; pair_why: string; has_combo: boolean })[] = [];
  for (const c of eligible) {
    const cls = c.medication.class_key;
    if (firstClasses.some((f) => pairBlocked(f, cls))) continue;
    const bonuses = firstClasses.map((f) => pairBonus(f, cls));
    const best = bonuses.sort((x, y) => y.bonus - x.bonus)[0] ?? { bonus: 0, why: "" };
    const hasCombo = comboPartners.has(c.medication.id);
    const add = best.bonus + (hasCombo ? 3 : 0);
    out.push({
      ...c,
      rule_score: Math.max(1, Math.min(99, c.rule_score + Math.round(add / 2))),
      pair_bonus: best.bonus,
      pair_why: best.why + (hasCombo ? " Available as a single combination pill with the first drug." : ""),
      has_combo: hasCombo,
    });
  }
  return out.sort((a, b) => b.rule_score - a.rule_score);
}

// ---------------------------------------------------------------------------
// Single-pill combination vs two separate pills
// ---------------------------------------------------------------------------
export interface ComboProduct {
  rxcui: string;
  name: string;
  dose_a: number;
  dose_b: number;
  extended: boolean;
}
export interface Combination {
  id: string;
  name: string;
  medication_a: string;
  medication_b: string;
  brand_names: string[];
  products: ComboProduct[];
}

export interface PriceRow {
  rxcui: string;
  name: string;
  medication_id: string | null;
  combination_id: string | null;
  dose_mg: number | null;
  nadac_per_unit: number | null;
}

export function findCombination(combos: Combination[], a: string, b: string) {
  return combos.find((c) => (c.medication_a === a && c.medication_b === b) || (c.medication_a === b && c.medication_b === a)) ?? null;
}

/** Pick the combo strength that matches the chosen doses (exact if possible, otherwise the closest sensible one). */
/** Keep only combo products in the same release form as the chosen drugs (e.g. metoprolol succinate ER, not tartrate). */
export function sameForm(combo: Combination, medsById: Map<string, Medication>): Combination {
  const ma = medsById.get(combo.medication_a);
  const mb = medsById.get(combo.medication_b);
  const wantsER = [ma, mb].some((m) => m && /extended-release|succinate/.test(m.generic_name));
  const products = combo.products.filter((p) => {
    if (wantsER !== Boolean(p.extended)) return false;
    for (const m of [ma, mb]) if (m && /succinate/.test(m.generic_name) && !/succinate/i.test(p.name)) return false;
    return true;
  });
  // brand names are per ingredient pair, not per release form; drop them if we filtered forms out
  return { ...combo, products, brand_names: products.length === combo.products.length ? combo.brand_names : [] };
}

export function pickStrength(combo: Combination, medA: string, doseA: number, doseB: number) {
  const flip = combo.medication_a !== medA;
  const want = flip ? { a: doseB, b: doseA } : { a: doseA, b: doseB };
  const exact = combo.products.find((p) => p.dose_a === want.a && p.dose_b === want.b);
  if (exact) return { product: exact, exact: true, flip };
  // closest within half to double of each chosen dose
  const near = combo.products
    .filter((p) => p.dose_a >= want.a / 2 && p.dose_a <= want.a * 2 && p.dose_b >= want.b / 2 && p.dose_b <= want.b * 2)
    .map((p) => ({ p, d: Math.abs(Math.log(p.dose_a / want.a)) + Math.abs(Math.log(p.dose_b / want.b)) }))
    .sort((x, y) => x.d - y.d)[0];
  return near ? { product: near.p, exact: false, flip } : null;
}

/** Clinical reasons to start the two drugs as separate pills (so each can be adjusted on its own). */
export function separateReasons(p: PatientProfile, a: Medication, b: Medication) {
  const r: string[] = [];
  const raas = [a, b].some((m) => RAAS.includes(m.class_key));
  if ((p.age ?? 0) >= 80) r.push("Age 80+: start one drug at a time to avoid low blood pressure and falls.");
  if (p.conditions.has("orthostatic_hypotension")) r.push("Orthostatic hypotension: titrate each drug separately.");
  if (raas && p.egfr !== null && p.egfr < 45) r.push(`eGFR ${p.egfr}: start the RAAS blocker alone and recheck kidney function before adding the second drug.`);
  if (raas && p.potassium !== null && p.potassium >= 5.0) r.push(`Potassium ${p.potassium}: adjust the RAAS blocker separately.`);
  for (const m of [a, b]) if (m.doses_per_day?.startsWith("2")) r.push(`${m.generic_name} is taken twice daily, so it can't share a once-daily combination pill.`);
  return r;
}

const DAYS = 30;

export function unitPrice(prices: PriceRow[], medicationId: string, doseMg: number | null) {
  const rows = prices.filter((x) => x.medication_id === medicationId && x.nadac_per_unit != null);
  if (!rows.length) return null;
  const exact = doseMg != null ? rows.filter((x) => Number(x.dose_mg) === Number(doseMg)) : [];
  const pool = exact.length ? exact : rows; // fall back to any strength (generic prices are flat across strengths)
  const sorted = pool.map((x) => Number(x.nadac_per_unit)).sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Estimated 30-day cost at NADAC (what pharmacies pay); a cash-price proxy, not the patient's copay. */
export function monthlyCost(prices: PriceRow[], m: Pick<Medication, "id" | "doses_per_day">, doseMg: number | null) {
  const u = unitPrice(prices, m.id, doseMg);
  if (u == null) return null;
  const perDay = m.doses_per_day?.startsWith("2") ? 2 : 1;
  return Math.round(u * perDay * DAYS * 100) / 100;
}

export function comboMonthlyCost(prices: PriceRow[], productRxcui: string) {
  const row = prices.find((x) => x.rxcui === productRxcui && x.nadac_per_unit != null);
  return row ? Math.round(Number(row.nadac_per_unit) * DAYS * 100) / 100 : null;
}
