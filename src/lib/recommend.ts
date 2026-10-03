import "server-only";
import { db, must } from "./supabase";
import { buildProfile, defaultRegimen, diversify, missingInputs, scoreCandidates, type ModifierRow, type ScoredCandidate, type Table1Row } from "./scoring";
import { llmModelName, llmProvider } from "./llm";
import { rankCandidates } from "./clinical";
import { CLASS_LABEL, decidePlan, findCombination, monthlyCost, scoreSecondPill, type Combination, type PriceRow } from "./plan";
import type { Diagnosis, Encounter, Medication, Patient } from "./types";
import { coverageFor, loadCoverageContext } from "./coverage-server";

/**
 * Generate recommendations for one "slot":
 *   slot 1 = the first (or only) drug; in add-on mode, the drug added to what the patient already takes
 *   slot 2 = the second drug of a two-drug regimen, complementary to the chosen first drug
 *
 * Flow per slot: TABLE 1 (diagnosis -> meds) -> TABLE 2 (patient modifiers) -> pairing rules (slot 2)
 * -> AI ranking -> price tie-break -> persist.
 */
export async function recommend(encounterId: string, opts: { slot: 1 | 2; first?: { medication_id: string; dose_mg: number | null; recommendation_id?: string } }) {
  const encounter = must(await db().from("encounters").select("*").eq("id", encounterId).single()) as Encounter & { plan: Record<string, unknown> };
  const patient = must(await db().from("patients").select("*").eq("id", encounter.patient_id).single()) as Patient;
  const diagnosis = must(await db().from("diagnoses").select("*").eq("id", encounter.diagnosis_id).single()) as Diagnosis;

  const table1 = must(
    await db().from("diagnosis_medications").select("medication_id,line_of_therapy,base_score,guideline,notes").eq("diagnosis_id", diagnosis.id),
  ) as Table1Row[];
  const meds = must(await db().from("medications").select("*").in("id", table1.map((r) => r.medication_id))) as Medication[];
  const modifiers = must(await db().from("demographic_modifiers").select("*").eq("active", true)) as ModifierRow[];
  const combos = (must(await db().from("combination_products").select("*")) as Combination[]) ?? [];
  const prices = (must(await db().from("drug_prices").select("rxcui,name,medication_id,combination_id,dose_mg,nadac_per_unit")) as PriceRow[]) ?? [];

  const profile = buildProfile(patient, encounter);
  const scored = scoreCandidates(table1, meds, modifiers, profile);
  const eligible = scored.filter((c) => !c.contraindicated);
  const excluded = scored.filter((c) => c.contraindicated);
  const missing = missingInputs(profile);
  const plan = decidePlan(profile, diagnosis.id);
  const medById = new Map(meds.map((m) => [m.id, m]));

  // ---- candidates for this slot ----------------------------------------
  let candidates: ScoredCandidate[];
  let pairWith: { name: string; drug_class: string; dose_mg: number | null; already_taking: boolean }[] | undefined;
  let pairNotes = new Map<string, string>();

  if (opts.slot === 2 || plan.mode === "add_on") {
    const firstMed = opts.first ? medById.get(opts.first.medication_id) : undefined;
    const firstClasses = firstMed ? [firstMed.class_key] : plan.current;
    pairWith = firstMed
      ? [{ name: firstMed.generic_name, drug_class: firstMed.drug_class, dose_mg: opts.first?.dose_mg ?? null, already_taking: false }]
      : plan.current.map((c) => ({ name: patient.current_medications.join(", "), drug_class: CLASS_LABEL[c] ?? c, dose_mg: null, already_taking: true }));
    const partners = new Set<string>();
    if (firstMed) for (const c of combos) if (c.medication_a === firstMed.id) partners.add(c.medication_b); else if (c.medication_b === firstMed.id) partners.add(c.medication_a);
    const second = scoreSecondPill(
      eligible.filter((c) => !firstMed || c.medication.id !== firstMed.id),
      firstClasses,
      partners,
    );
    pairNotes = new Map(second.map((c) => [c.medication.id, c.pair_why]));
    // show the pairing bonus as evidence on the card
    candidates = diversify(
      second.map((c) => ({
        ...c,
        fired: c.pair_bonus || c.has_combo
          ? [...c.fired, { effect: "prefer" as const, delta: c.pair_bonus + (c.has_combo ? 3 : 0), rationale: c.pair_why.trim(), source: "2017/2025 ACC/AHA combination therapy guidance", source_url: "https://www.ahajournals.org/doi/10.1161/HYP.0000000000000249", matched: "pairing" }]
          : c.fired,
      })),
      10,
    );
  } else {
    candidates = diversify(eligible, 12);
  }
  if (!candidates.length) throw Object.assign(new Error("No safe medication found for this slot."), { status: 422 });

  // ---- AI ranking (falls back to rules) --------------------------------
  let engine: "ai" | "rules" = "rules";
  let clinicalNote: string | null = null;
  let usage: unknown = null;
  let model: string | null = null;
  let aiError: string | null = null;
  const createdAt = new Date().toISOString();
  type Row = Record<string, unknown> & { medication_id: string; match_percent: number; dose_mg: number | null };
  let rows: Row[] = [];

  if (llmProvider()) {
    try {
      const out = await rankCandidates({ patient, profile, encounter, diagnosis, candidates, excluded, missing, pairWith, plan });
      const byId = new Map(candidates.map((c) => [c.medication.id, c]));
      const seen = new Set<string>();
      const recs = out.data.recommendations.filter((r) => byId.has(r.medication_id) && !seen.has(r.medication_id) && seen.add(r.medication_id)).slice(0, 3);
      if (recs.length) {
        engine = "ai";
        model = out.model;
        usage = out.usage;
        clinicalNote = [
          out.data.clinical_summary,
          out.data.combination_note && opts.slot === 1 ? `Combination therapy: ${out.data.combination_note}` : null,
          out.data.safety_flags.length ? `Safety flags: ${out.data.safety_flags.join("; ")}` : null,
        ]
          .filter(Boolean)
          .join("\n\n");
        rows = recs.map((r) => {
          const c = byId.get(r.medication_id)!;
          const min = c.medication.usual_dose_min_mg ?? 0;
          const max = c.medication.usual_dose_max_mg ?? Number.MAX_SAFE_INTEGER;
          const floor = Math.min(min, c.medication.start_dose_elderly_mg ?? c.medication.start_dose_mg ?? min);
          const ok = r.dose_mg >= floor && r.dose_mg <= max;
          const fb = defaultRegimen(c.medication, profile.age);
          return {
            medication_id: r.medication_id,
            match_percent: Math.max(1, Math.min(99, Math.round(r.match_percent))),
            rule_score: c.rule_score,
            summary: r.summary,
            rationale: r.rationale,
            factors_for: r.factors_for,
            factors_against: r.factors_against,
            dose_mg: ok ? r.dose_mg : fb.dose_mg,
            sig: ok ? r.sig : fb.sig,
            dispense_quantity: r.dispense_quantity || fb.dispense_quantity,
            days_supply: r.days_supply || fb.days_supply,
            fills_allowed: r.fills_allowed || fb.fills_allowed,
            monitoring: r.monitoring,
          };
        });
      }
    } catch (e) {
      aiError = e instanceof Error ? e.message : String(e);
      console.error("[recommend] AI ranking failed, using rule engine:", aiError);
    }
  }
  if (engine === "rules") {
    rows = candidates.slice(0, 3).map((c) => {
      const reg = defaultRegimen(c.medication, profile.age);
      return {
        medication_id: c.medication.id,
        match_percent: c.rule_score,
        rule_score: c.rule_score,
        summary: pairNotes.get(c.medication.id) || `${c.medication.drug_class} — ${c.line_of_therapy.replace("_", " ")}.`,
        rationale: c.fired.length ? c.fired.map((f) => `${f.delta >= 0 ? "+" : ""}${f.delta}: ${f.rationale}`).join(" ") : "Ranked by guideline line of therapy.",
        factors_for: c.fired.filter((f) => f.delta > 0).map((f) => f.rationale),
        factors_against: c.fired.filter((f) => f.delta < 0).map((f) => f.rationale),
        ...reg,
        monitoring: c.medication.monitoring,
      };
    });
    clinicalNote = aiError ? `The AI model was unavailable (${aiError}). These results come from the rule engine only.` : "No AI model is configured. These results come from the rule engine only.";
  }

  // ---- insurance coverage: clinical % + capped adjustment ----------------
  const coverageCtx = await loadCoverageContext(patient, encounter);
  const safeMeds = eligible.map((c) => c.medication);
  for (const r of rows) {
    const med = medById.get(r.medication_id)!;
    const cov = coverageFor(coverageCtx, prices, safeMeds, med, r.dose_mg);
    r.clinical_percent = r.match_percent;
    r.coverage = cov;
    r.match_percent = Math.max(1, Math.min(99, r.match_percent + cov.adjustment));
    if (cov.adjustment !== 0) {
      const list = (cov.adjustment > 0 ? r.factors_for : r.factors_against) as string[];
      list.push(`${cov.plan_name}: ${cov.label}${cov.notes[0] ? ` — ${cov.notes[0]}` : ""}`);
    }
  }

  // ---- monthly cost + price tie-break ----------------------------------
  for (const r of rows) r.monthly_cost = monthlyCost(prices, medById.get(r.medication_id)!, r.dose_mg);
  rows.sort((a, b) => b.match_percent - a.match_percent);
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    const ca = a.monthly_cost as number | null, cb = b.monthly_cost as number | null;
    // effectively tied on fit (within 2 points) -> the cheaper one goes first
    if (a.match_percent - b.match_percent <= 2 && ca != null && cb != null && cb + 0.5 < ca) {
      rows[i] = b;
      rows[i + 1] = a;
      (b.factors_for as string[]).unshift(`Tie with ${medById.get(a.medication_id)?.generic_name} broken by price (~$${cb.toFixed(2)} vs $${ca.toFixed(2)}/month)`);
    }
  }

  // ---- persist ----------------------------------------------------------
  const insert = rows.map((r, i) => ({ ...r, encounter_id: encounterId, rank: i + 1, slot: opts.slot, engine, model, created_at: createdAt }));
  must(await db().from("recommendations").insert(insert).select("id"));
  must(
    await db()
      .from("generation_runs")
      .insert({
        encounter_id: encounterId,
        engine,
        model: model ?? (engine === "ai" ? llmModelName() : null),
        candidates: candidates.map((c) => ({ slot: opts.slot, medication_id: c.medication.id, name: c.medication.generic_name, line_of_therapy: c.line_of_therapy, base_score: c.base_score, rule_score: c.rule_score, fired: c.fired })),
        excluded: excluded.map((c) => ({ medication_id: c.medication.id, name: c.medication.generic_name, reasons: c.fired.filter((f) => f.effect === "contraindicated").map((f) => ({ matched: f.matched, rationale: f.rationale, source: f.source })) })),
        clinical_note: clinicalNote,
        stop_reason: engine === "ai" ? "end_turn" : null,
        usage,
      })
      .select("id"),
  );

  const nextPlan =
    opts.slot === 1
      ? { mode: plan.mode, reason: plan.reason, current: plan.current, pill1: null }
      : { ...(encounter.plan ?? {}), pill1: opts.first ?? null };
  must(await db().from("encounters").update({ status: "recommended", plan: nextPlan, updated_at: createdAt }).eq("id", encounterId).select("id"));

  return { engine, missing, error: aiError, plan: nextPlan, combinationAvailable: opts.first ? Boolean(findCombination(combos, opts.first.medication_id, rows[0]?.medication_id)) : undefined };
}
