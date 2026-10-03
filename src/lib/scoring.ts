import type { Encounter, Medication, Patient } from "./types";

/**
 * Deterministic rule engine.
 *  Table 1 (diagnosis_medications) gives each candidate a base score.
 *  Table 2 (demographic_modifiers) adds/subtracts points per patient factor.
 * Anything with a "contraindicated" modifier is excluded outright.
 * The AI model then ranks the surviving candidates using the full visit context.
 */

export interface PatientProfile {
  age: number | null;
  sex: Patient["sex"];
  ethnicity: string | null;
  bmi: number | null;
  pregnancy: Patient["pregnancy_status"];
  conditions: Set<string>;
  medTags: Set<string>;
  allergyTags: Set<string>;
  egfr: number | null;
  potassium: number | null;
  sodium: number | null;
  uacr: number | null;
  heart_rate: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
}

export interface Predicate {
  factor: string;
  op: "has" | "is" | ">=" | "<=" | ">" | "<";
  value: string | number;
}

export interface ModifierRow {
  id: string;
  target_type: "class" | "drug";
  target: string;
  conditions: Predicate[];
  effect: "contraindicated" | "avoid" | "caution" | "neutral" | "prefer" | "strongly_prefer";
  score_delta: number;
  rationale: string;
  source: string;
  source_url: string | null;
  active: boolean;
}

export interface Table1Row {
  medication_id: string;
  line_of_therapy: string;
  base_score: number;
  guideline: string;
  notes: string | null;
}

export interface FiredModifier {
  effect: ModifierRow["effect"];
  delta: number;
  rationale: string;
  source: string;
  source_url: string | null;
  matched: string; // human description of which patient factor matched
}

export interface ScoredCandidate {
  medication: Medication;
  line_of_therapy: string;
  guideline: string;
  base_score: number;
  rule_score: number;
  fired: FiredModifier[];
  contraindicated: boolean;
}

export function ageFrom(dob: string | null, at = new Date()): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  let a = at.getFullYear() - d.getFullYear();
  const m = at.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < d.getDate())) a--;
  return a;
}

export function bmiFrom(heightCm: number | null, weightKg: number | null): number | null {
  if (!heightCm || !weightKg) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

// Free-text current meds -> tags the modifiers reference
const MED_TAG_PATTERNS: [RegExp, string[]][] = [
  [/\b\w+pril\b|zestril|prinivil|vasotec|altace|lotensin|accupril/i, ["acei"]],
  [/\b\w+sartan\b|cozaar|diovan|benicar|avapro|micardis|atacand/i, ["arb"]],
  [/entresto|sacubitril/i, ["sacubitril", "arb"]],
  [/\b\w+olol\b|carvedilol|labetalol|toprol|lopressor|coreg|tenormin|bystolic|zebeta/i, ["beta_blocker"]],
  [/verapamil|diltiazem|cardizem|calan/i, ["ccb_nondhp"]],
  [/amlodipine|nifedipine|felodipine|norvasc|procardia/i, ["ccb_dhp"]],
  [/thiazide|chlorthalidone|indapamide|metolazone/i, ["thiazide"]],
  [/furosemide|torsemide|bumetanide|lasix/i, ["loop"]],
  [/spironolactone|eplerenone|aldactone|finerenone/i, ["mra"]],
  [/tamsulosin|alfuzosin|silodosin|doxazosin|terazosin|prazosin|flomax|uroxatral|rapaflo|cardura|hytrin|minipress/i, ["alpha_blocker"]],
  [/clonidine|guanfacine|methyldopa|catapres/i, ["central_alpha"]],
  [/lithium/i, ["lithium"]],
  [/ibuprofen|naproxen|diclofenac|meloxicam|celecoxib|indomethacin|ketorolac|advil|motrin|aleve|nsaid/i, ["nsaid"]],
  [/digoxin|lanoxin/i, ["digoxin"]],
  [/potassium chloride|klor-con|k-dur|potassium supplement|\bkcl\b/i, ["potassium_supplement"]],
  [/ketoconazole|itraconazole|clarithromycin|ritonavir|nefazodone|posaconazole|voriconazole|cobicistat/i, ["strong_cyp3a4_inhibitor"]],
];

export function medTags(meds: string[]): Set<string> {
  const tags = new Set<string>();
  for (const m of meds) for (const [re, t] of MED_TAG_PATTERNS) if (re.test(m)) t.forEach((x) => tags.add(x));
  return tags;
}

export function allergyTags(allergies: string[], conditions: string[]): Set<string> {
  const tags = new Set<string>();
  for (const a of allergies) {
    if (/\b\w+pril\b|ace.?inhibitor/i.test(a)) tags.add(/cough/i.test(a) ? "acei_cough" : "acei");
    if (/\b\w+sartan\b|\barb\b/i.test(a)) tags.add("arb");
    if (/sulfa|sulfonamide/i.test(a)) tags.add("sulfa");
  }
  if (conditions.includes("acei_cough")) tags.add("acei_cough");
  return tags;
}

export function buildProfile(p: Patient, e: Pick<Encounter, "vitals" | "labs">): PatientProfile {
  const num = (v: unknown) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    age: ageFrom(p.date_of_birth),
    sex: p.sex,
    ethnicity: p.ethnicity,
    bmi: bmiFrom(p.height_cm, p.weight_kg),
    pregnancy: p.pregnancy_status,
    conditions: new Set(p.conditions),
    medTags: medTags(p.current_medications),
    allergyTags: allergyTags(p.allergies, p.conditions),
    egfr: num(e.labs?.egfr),
    potassium: num(e.labs?.potassium),
    sodium: num(e.labs?.sodium),
    uacr: num(e.labs?.uacr),
    heart_rate: num(e.vitals?.heart_rate),
    bp_systolic: num(e.vitals?.bp_systolic),
    bp_diastolic: num(e.vitals?.bp_diastolic),
  };
}

function matches(pr: Predicate, p: PatientProfile): string | null {
  switch (pr.factor) {
    case "condition":
      return p.conditions.has(String(pr.value)) ? `condition: ${pr.value}` : null;
    case "medication":
      return p.medTags.has(String(pr.value)) ? `current med: ${pr.value}` : null;
    case "allergy":
      return p.allergyTags.has(String(pr.value)) ? `allergy/intolerance: ${pr.value}` : null;
    case "ethnicity":
      return p.ethnicity === pr.value ? `ethnicity: ${pr.value}` : null;
    case "sex":
      return p.sex === pr.value ? `sex: ${pr.value}` : null;
    case "pregnancy":
      return p.pregnancy === pr.value ? `pregnancy: ${pr.value}` : null;
    default: {
      const v = (p as unknown as Record<string, number | null>)[pr.factor];
      if (v === null || v === undefined) return null;
      const t = Number(pr.value);
      const ok =
        pr.op === ">=" ? v >= t : pr.op === "<=" ? v <= t : pr.op === ">" ? v > t : pr.op === "<" ? v < t : false;
      return ok ? `${pr.factor} ${v} ${pr.op} ${t}` : null;
    }
  }
}

/** Smoothly map raw points (base + modifiers, unbounded) to 1-99 without ties at the top. */
export function toPercent(raw: number) {
  return Math.max(1, Math.min(99, Math.round(100 * (1 - Math.exp(-Math.max(raw, 0) / 45)))));
}

/**
 * Shortlist that keeps the strongest options per class so the top 3 isn't
 * five ACE inhibitors: best drug of every class first, then runners-up.
 */
export function diversify(scored: ScoredCandidate[], limit: number) {
  const byClass = new Map<string, ScoredCandidate[]>();
  for (const c of scored) {
    const k = c.medication.class_key;
    byClass.set(k, [...(byClass.get(k) ?? []), c]);
  }
  const out: ScoredCandidate[] = [];
  for (let round = 0; out.length < limit && round < 3; round++) {
    const layer = Array.from(byClass.values())
      .map((list) => list[round])
      .filter(Boolean)
      .sort((a, b) => b.rule_score - a.rule_score);
    out.push(...layer.slice(0, limit - out.length));
  }
  return out;
}

/** A drug the patient has taken before, and how it went (from medication_trials). */
export type PriorTrial = { medication_id: string | null; drug_name: string; outcome: string; detail: string | null; ended_on?: string | null };

/** What the patient's own history says about re-using a drug. */
function historyFor(medId: string, trials: PriorTrial[]): FiredModifier[] {
  const out: FiredModifier[] = [];
  for (const t of trials) {
    if (t.medication_id !== medId) continue;
    const why = t.detail ? `: ${t.detail}` : "";
    const base = { source: "Patient medication history", source_url: null, matched: "medication history" };
    if (t.outcome === "allergy" || t.outcome === "contraindicated")
      out.push({ ...base, effect: "contraindicated", delta: -100, rationale: `Previous ${t.outcome === "allergy" ? "allergic reaction" : "contraindication"} to ${t.drug_name}${why}.` });
    else if (t.outcome === "side_effect")
      out.push({ ...base, effect: "avoid", delta: -45, rationale: `Stopped before because of a side effect${why}. Re-challenge only if no better option.` });
    else if (t.outcome === "not_at_goal" && t.ended_on)
      out.push({ ...base, effect: "caution", delta: -20, rationale: `Tried before without reaching BP goal${why}.` });
  }
  return out;
}

export function scoreCandidates(
  table1: Table1Row[],
  meds: Medication[],
  modifiers: ModifierRow[],
  profile: PatientProfile,
  trials: PriorTrial[] = [],
): ScoredCandidate[] {
  const medById = new Map(meds.map((m) => [m.id, m]));
  const out: ScoredCandidate[] = [];
  for (const row of table1) {
    const medication = medById.get(row.medication_id);
    if (!medication) continue;
    const fired: FiredModifier[] = [];
    for (const mod of modifiers) {
      if (!mod.active) continue;
      const hit =
        (mod.target_type === "class" && mod.target === medication.class_key) ||
        (mod.target_type === "drug" && mod.target === medication.id);
      if (!hit) continue;
      const parts: string[] = [];
      let all = true;
      for (const pr of mod.conditions) {
        const m = matches(pr, profile);
        if (!m) {
          all = false;
          break;
        }
        parts.push(m);
      }
      if (!all) continue;
      fired.push({
        effect: mod.effect,
        delta: mod.score_delta,
        rationale: mod.rationale,
        source: mod.source,
        source_url: mod.source_url,
        matched: parts.join(" + "),
      });
    }
    fired.push(...historyFor(medication.id, trials));
    const contraindicated = fired.some((f) => f.effect === "contraindicated");
    const raw = row.base_score + fired.reduce((s, f) => s + f.delta, 0);
    out.push({
      medication,
      line_of_therapy: row.line_of_therapy,
      guideline: row.guideline,
      base_score: row.base_score,
      rule_score: contraindicated ? 0 : toPercent(raw),
      fired,
      contraindicated,
    });
  }
  return out.sort((a, b) => b.rule_score - a.rule_score);
}

/** Lab values that would change the result if they were known. */
export function missingInputs(p: PatientProfile): string[] {
  const miss: string[] = [];
  if (p.egfr === null) miss.push("eGFR");
  if (p.potassium === null) miss.push("serum potassium");
  if (p.uacr === null && (p.conditions.has("diabetes") || p.conditions.has("ckd"))) miss.push("urine albumin-creatinine ratio");
  if (p.heart_rate === null) miss.push("heart rate");
  if (p.bp_systolic === null) miss.push("blood pressure");
  if (p.age === null) miss.push("age");
  if (p.sex === null) miss.push("sex");
  return miss;
}

/** Pick an available strength closest to the target dose and build a default sig. */
export function defaultRegimen(m: Medication, age: number | null) {
  const dose = ((age ?? 0) >= 65 && m.start_dose_elderly_mg) || m.start_dose_mg || m.usual_dose_min_mg || 0;
  const twice = m.doses_per_day?.startsWith("2");
  const perDay = twice ? 2 : 1;
  return {
    dose_mg: dose,
    sig: `Take ${dose} mg by mouth ${twice ? "twice daily" : "once daily"}.`,
    dispense_quantity: 30 * perDay,
    days_supply: 30,
    fills_allowed: 3,
  };
}
